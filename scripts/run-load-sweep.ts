import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderLineChart, type LineSeries } from "./lib/svg-chart";
import { median } from "./lib/stats";

// Latency-versus-throughput sweep.
//
// For each observability mode the stack is brought up ONCE and then driven at an
// increasing series of offered arrival rates; per rate we record achieved
// throughput, latency percentiles, error rate, and CPU. This reveals (a) the load
// regime where the modes' curves diverge and (b) each mode's saturation knee — the
// load-robust complement to the fixed-rate campaign (scripts/run-load-experiment.ts).
//
// Caveat recorded in the report: k6 runs on the same host as the system under test,
// so the highest offered rates include some load-generator CPU contention.

type ModeId =
  | "baseline"
  | "metrics"
  | "metrics_logs"
  | "metrics_logs_traces"
  | "otel_full";

type Point = {
  offeredRate: number; // k6 iterations/s
  rep: number;
  achievedRps: number; // achieved HTTP requests/s
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  cpu: number;
  mem: number;
};

const MODE_PROFILES: Record<ModeId, string[]> = {
  baseline: [],
  metrics: ["metrics"],
  metrics_logs: ["metrics", "logs"],
  metrics_logs_traces: ["metrics", "logs", "traces"],
  otel_full: ["metrics", "logs", "traces", "otel"]
};

const MODE_OBS: Record<ModeId, string> = {
  baseline: "none",
  metrics: "metrics",
  metrics_logs: "metrics_logs",
  metrics_logs_traces: "metrics_logs_traces",
  otel_full: "otel_full"
};

const MODE_LABEL: Record<ModeId, string> = {
  baseline: "Baseline",
  metrics: "Metrics",
  metrics_logs: "Metrics + Logs",
  metrics_logs_traces: "Metrics + Logs + Traces",
  otel_full: "Full OpenTelemetry"
};

const MODE_COLOR: Record<ModeId, string> = {
  baseline: "#4e79a7",
  metrics: "#59a14f",
  metrics_logs: "#e15759",
  metrics_logs_traces: "#f28e2b",
  otel_full: "#76558e"
};

// Roughly three HTTP requests per transaction-flow iteration (create, read, history).
const REQUESTS_PER_ITERATION = 3;

const workspaceRoot = process.cwd();
const composeFile = resolve(
  workspaceRoot,
  "infra/docker/compose/docker-compose.base.yml"
);
const k6Dir = resolve(workspaceRoot, "load-tests", "k6");
const composeNetwork = "observable-microservice-lab_traceforge";
const composeProject = "observable-microservice-lab";
const k6Image = process.env.K6_IMAGE ?? "grafana/k6:0.54.0";
const coreServices = [
  "api-gateway",
  "transaction-service",
  "payment-service",
  "worker-service",
  "postgres",
  "redis",
  "rabbitmq"
];

const modes = parseModes(process.env.SWEEP_MODES, [
  "baseline",
  "metrics_logs",
  "otel_full"
]);
const rates = parseRates(process.env.SWEEP_RATES, [20, 40, 80, 160]);
const reps = toInt(process.env.SWEEP_REPS, 3);
const duration = process.env.DURATION ?? "15s";
const warmup = process.env.WARMUP ?? "8s";
const warmupRate = toInt(process.env.SWEEP_WARMUP_RATE, 40);
const measureSeconds = parseSeconds(duration);

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const rawRoot = resolve(workspaceRoot, "results", "raw", `sweep-${timestamp}`);
const processedDir = resolve(workspaceRoot, "results", "processed");
const chartsDir = resolve(workspaceRoot, "results", "charts");
const reportPath = resolve(workspaceRoot, "docs", "load-sweep-report.md");

async function main(): Promise<void> {
  await mkdir(rawRoot, { recursive: true });
  await mkdir(processedDir, { recursive: true });
  await mkdir(chartsDir, { recursive: true });

  console.log(
    `Sweep: modes=[${modes.join(", ")}] rates=[${rates.join(", ")}] iter/s ` +
      `reps=${reps} duration=${duration}`
  );
  console.log("Building service images from current source...");
  await compose(["build"], { allowFail: true, timeoutMs: 600000, stream: true });

  const byMode = new Map<ModeId, Point[]>();
  for (const mode of modes) {
    byMode.set(mode, await runMode(mode));
  }

  await writeCsvs(byMode);
  const charts = await renderCharts(byMode);
  await writeReport(byMode, charts);

  console.log(`\nDone. Per-mode CSVs: results/processed/sweep-<mode>.csv`);
  console.log(`Charts: ${charts.join(", ")}`);
  console.log(`Report: ${reportPath}`);
}

async function runMode(mode: ModeId): Promise<Point[]> {
  console.log(`\n===== ${mode} =====`);
  const env = composeEnv(mode);

  await compose(["down", "--remove-orphans"], {
    env,
    allowFail: true,
    timeoutMs: 120000
  });
  await compose([...profileArgs(MODE_PROFILES[mode]), "up", "-d"], {
    env,
    allowFail: true,
    timeoutMs: 300000,
    stream: true
  });

  const healthy = await waitUntil(() => coreHealthy(env), 240000);
  if (!healthy.ok) {
    console.log(`  ${mode}: core not healthy; skipping.`);
    await compose(["down", "--remove-orphans"], {
      env,
      allowFail: true,
      timeoutMs: 120000
    });
    return [];
  }
  await ensureSchema(env);

  console.log(`  ${mode}: warm-up (${warmup} @ ${warmupRate} iter/s)...`);
  await runK6(warmupRate, "warmup", warmup);

  const points: Point[] = [];
  for (const offeredRate of rates) {
    for (let rep = 1; rep <= reps; rep += 1) {
      const point = await measure(mode, offeredRate, rep);
      if (point) {
        points.push(point);
        console.log(
          `  ${mode} @${offeredRate} iter/s rep ${rep}/${reps}: ` +
            `p95=${point.p95.toFixed(1)}ms achieved=${point.achievedRps.toFixed(0)}req/s ` +
            `err=${(point.errorRate * 100).toFixed(1)}% cpu=${point.cpu.toFixed(1)}%`
        );
      }
    }
  }

  await compose(["down", "--remove-orphans"], {
    env,
    allowFail: true,
    timeoutMs: 120000
  });
  return points;
}

async function measure(
  mode: ModeId,
  offeredRate: number,
  rep: number
): Promise<Point | null> {
  const samples: Array<{ cpu: number; mem: number }> = [];
  const sampler = setInterval(() => {
    void sampleDockerStats(samples);
  }, 1000);

  const summaryFile = `k6-${mode}-r${offeredRate}-rep${rep}.json`;
  try {
    await runK6(offeredRate, `${mode}-r${offeredRate}-rep${rep}`, duration, summaryFile);
  } finally {
    clearInterval(sampler);
  }

  let summary: K6Summary;
  try {
    summary = JSON.parse(
      await readFile(resolve(rawRoot, summaryFile), "utf8")
    ) as K6Summary;
  } catch {
    return null;
  }

  const httpRequests = metric(summary, "http_reqs", "count");
  return {
    offeredRate,
    rep,
    achievedRps: measureSeconds > 0 ? httpRequests / measureSeconds : 0,
    errorRate: metric(summary, "http_req_failed", "rate"),
    p50: metric(summary, "http_req_duration", "med"),
    p95: metric(summary, "http_req_duration", "p(95)"),
    p99: metric(summary, "http_req_duration", "p(99)"),
    cpu: samples.length ? mean(samples.map((s) => s.cpu)) : 0,
    mem: samples.length ? Math.max(...samples.map((s) => s.mem)) : 0
  };
}

function runK6(
  rate: number,
  label: string,
  dur: string,
  summaryFile?: string
): Promise<void> {
  const preAllocatedVUs = Math.min(Math.max(rate * 2, 20), 200);
  const maxVUs = Math.min(rate * 8, 600);
  const args = [
    "run",
    "--rm",
    "--network",
    composeNetwork,
    "-v",
    `${k6Dir}:/scripts:ro`,
    "-v",
    `${rawRoot}:/results`,
    k6Image,
    "run",
    ...(summaryFile ? ["--summary-export", `/results/${summaryFile}`] : []),
    "-e",
    "BASE_URL=http://api-gateway:3000",
    "-e",
    `RATE=${rate}`,
    "-e",
    `DURATION=${dur}`,
    "-e",
    `PRE_ALLOCATED_VUS=${preAllocatedVUs}`,
    "-e",
    `MAX_VUS=${maxVUs}`,
    "/scripts/constant-rate.js"
  ];
  return run("docker", args, { allowFail: true, timeoutMs: 300000 }).then(
    () => undefined
  );
}

// --- analysis + outputs -------------------------------------------------------

type Aggregate = {
  offeredRate: number;
  offeredReqRps: number;
  achieved: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  cpu: number;
};

function aggregate(points: Point[]): Aggregate[] {
  return rates
    .map((offeredRate) => {
      const reps = points.filter((point) => point.offeredRate === offeredRate);
      if (reps.length === 0) {
        return null;
      }
      return {
        offeredRate,
        offeredReqRps: offeredRate * REQUESTS_PER_ITERATION,
        achieved: median(reps.map((r) => r.achievedRps)),
        p50: median(reps.map((r) => r.p50)),
        p95: median(reps.map((r) => r.p95)),
        p99: median(reps.map((r) => r.p99)),
        errorRate: median(reps.map((r) => r.errorRate)),
        cpu: median(reps.map((r) => r.cpu))
      };
    })
    .filter((value): value is Aggregate => value !== null);
}

async function writeCsvs(byMode: Map<ModeId, Point[]>): Promise<void> {
  const header = [
    "offered_iter_rate",
    "offered_req_rps",
    "rep",
    "achieved_req_rps",
    "error_rate",
    "p50_ms",
    "p95_ms",
    "p99_ms",
    "cpu_percent",
    "max_memory_bytes"
  ].join(",");
  for (const [mode, points] of byMode) {
    const rows = points.map((p) =>
      [
        p.offeredRate,
        p.offeredRate * REQUESTS_PER_ITERATION,
        p.rep,
        round(p.achievedRps, 2),
        round(p.errorRate, 4),
        round(p.p50, 3),
        round(p.p95, 3),
        round(p.p99, 3),
        round(p.cpu, 2),
        Math.round(p.mem)
      ].join(",")
    );
    await writeFile(
      resolve(processedDir, `sweep-${mode}.csv`),
      `${[header, ...rows].join("\n")}\n`
    );
  }
}

async function renderCharts(byMode: Map<ModeId, Point[]>): Promise<string[]> {
  const activeModes = [...byMode.keys()].filter(
    (mode) => (byMode.get(mode) ?? []).length > 0
  );

  const latencySeries: LineSeries[] = activeModes.map((mode) => ({
    name: MODE_LABEL[mode],
    color: MODE_COLOR[mode],
    points: aggregate(byMode.get(mode) ?? []).map((a) => ({
      x: a.offeredReqRps,
      y: a.p95
    }))
  }));
  const throughputSeries: LineSeries[] = activeModes.map((mode) => ({
    name: MODE_LABEL[mode],
    color: MODE_COLOR[mode],
    points: aggregate(byMode.get(mode) ?? []).map((a) => ({
      x: a.offeredReqRps,
      y: a.achieved
    }))
  }));

  const latencyChart = "sweep-latency-vs-load.svg";
  const throughputChart = "sweep-throughput.svg";
  await writeFile(
    resolve(chartsDir, latencyChart),
    renderLineChart({
      title: "p95 latency vs offered load",
      subtitle:
        "Median of reps per point; curves diverge as instrumented modes saturate earlier",
      series: latencySeries,
      xAxisLabel: "offered request rate (req/s)",
      yAxisLabel: "p95 latency (ms)",
      formatX: (v) => v.toFixed(0),
      formatY: (v) => v.toFixed(0)
    })
  );
  await writeFile(
    resolve(chartsDir, throughputChart),
    renderLineChart({
      title: "Achieved vs offered throughput (saturation)",
      subtitle:
        "Where a curve falls below the diagonal (achieved < offered), that mode is saturating",
      series: throughputSeries,
      xAxisLabel: "offered request rate (req/s)",
      yAxisLabel: "achieved request rate (req/s)",
      formatX: (v) => v.toFixed(0),
      formatY: (v) => v.toFixed(0)
    })
  );
  return [latencyChart, throughputChart];
}

async function writeReport(
  byMode: Map<ModeId, Point[]>,
  charts: string[]
): Promise<void> {
  const lines: string[] = [];
  lines.push("# Latency vs Throughput Sweep");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push(
    "Each mode's stack is brought up once and driven at an increasing series of offered " +
      `arrival rates (${rates.join(", ")} iterations/s, i.e. ~${rates.map((r) => r * REQUESTS_PER_ITERATION).join(", ")} req/s), ` +
      `with ${reps} repetitions of ${duration} per rate (median reported). This shows the ` +
      "load regime where the modes diverge and where each saturates — the load-robust " +
      "complement to the fixed-rate campaign in `statistics-load-report.md`."
  );
  lines.push("");

  for (const mode of byMode.keys()) {
    const rows = aggregate(byMode.get(mode) ?? []);
    if (rows.length === 0) {
      continue;
    }
    lines.push(`### ${MODE_LABEL[mode]}`);
    lines.push("");
    lines.push(
      "| Offered req/s | Achieved req/s | p50 (ms) | p95 (ms) | Error % | CPU % |"
    );
    lines.push("| ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const r of rows) {
      lines.push(
        `| ${r.offeredReqRps} | ${r.achieved.toFixed(0)} | ${r.p50.toFixed(1)} | ` +
          `${r.p95.toFixed(1)} | ${(r.errorRate * 100).toFixed(1)} | ${r.cpu.toFixed(1)} |`
      );
    }
    lines.push("");
  }

  lines.push("## Figures");
  lines.push("");
  for (const chart of charts) {
    lines.push(`![${chart}](../results/charts/${chart})`);
    lines.push("");
  }

  lines.push("## How to read");
  lines.push("");
  lines.push(
    "- **Latency-vs-load:** at low offered load all modes sit close together (the small " +
      "absolute baseline makes relative overhead look large but costs little in milliseconds); " +
      "as load rises the instrumented curves climb and bend upward sooner."
  );
  lines.push(
    "- **Saturation:** where an _achieved_ curve falls below the diagonal (achieved < offered), " +
      "that mode can no longer keep up — its knee. More-instrumented modes reach the knee at a " +
      "lower offered rate."
  );
  lines.push("");
  lines.push("## Threats to validity");
  lines.push("");
  lines.push(
    "- **Co-located load generator:** k6 runs on the same host as the system under test, so " +
      "the highest offered rates include some load-generator CPU contention; treat the absolute " +
      "high-load latencies as an upper bound."
  );
  lines.push(
    "- **Single machine, point-in-time:** see `reproducibility.md` for the recorded environment."
  );
  lines.push("");
  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push(
    "pnpm sweep:run   # SWEEP_MODES, SWEEP_RATES, SWEEP_REPS, DURATION are configurable"
  );
  lines.push("```");
  lines.push("");
  await writeFile(reportPath, lines.join("\n"));
}

// --- compose / docker helpers (shared shape with run-load-experiment.ts) ------

function composeEnv(mode: ModeId): NodeJS.ProcessEnv {
  const ephemeral: Record<string, string> = {
    API_GATEWAY_PORT: "0",
    TRANSACTION_SERVICE_PORT: "0",
    PAYMENT_SERVICE_PORT: "0",
    WORKER_SERVICE_PORT: "0",
    POSTGRES_PORT: "0",
    REDIS_PORT: "0",
    RABBITMQ_PORT: "0",
    RABBITMQ_MANAGEMENT_PORT: "0",
    PROMETHEUS_PORT: "0",
    GRAFANA_PORT: "0",
    LOKI_PORT: "0",
    JAEGER_UI_PORT: "0",
    OTEL_GRPC_PORT: "0",
    OTEL_HTTP_PORT: "0",
    OTEL_COLLECTOR_HEALTH_PORT: "0",
    OTEL_COLLECTOR_METRICS_PORT: "0",
    OTEL_COLLECTOR_PROMETHEUS_PORT: "0"
  };
  return {
    ...process.env,
    ...ephemeral,
    OBS_MODE: MODE_OBS[mode],
    ...(mode === "otel_full"
      ? { OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4318" }
      : {})
  };
}

function profileArgs(profiles: string[]): string[] {
  return profiles.flatMap((profile) => ["--profile", profile]);
}

function compose(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    allowFail?: boolean;
    timeoutMs?: number;
    stream?: boolean;
  }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return run("docker", ["compose", "-f", composeFile, ...args], options);
}

async function coreHealthy(env: NodeJS.ProcessEnv): Promise<boolean> {
  const result = await compose(["ps", "--format", "json"], { env, allowFail: true });
  const entries = ndjson(result.stdout);
  return coreServices.every((service) =>
    entries.some((e) => e.Service === service && String(e.Health ?? "") === "healthy")
  );
}

async function ensureSchema(env: NodeJS.ProcessEnv): Promise<void> {
  await compose(
    [
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "traceforge",
      "-d",
      "traceforge",
      "-f",
      "/docker-entrypoint-initdb.d/001_init.sql"
    ],
    { env, allowFail: true, timeoutMs: 60000 }
  );
}

async function sampleDockerStats(
  samples: Array<{ cpu: number; mem: number }>
): Promise<void> {
  const result = await run("docker", ["stats", "--no-stream", "--format", "{{json .}}"], {
    allowFail: true
  });
  for (const entry of ndjson(result.stdout)) {
    const name = String(entry.Name ?? "");
    if (name.startsWith(`${composeProject}-`)) {
      samples.push({
        cpu: parsePercent(String(entry.CPUPerc ?? "0%")),
        mem: parseMemoryBytes(String(entry.MemUsage ?? "0B"))
      });
    }
  }
}

// --- low-level utilities ------------------------------------------------------

function run(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    allowFail?: boolean;
    timeoutMs?: number;
    stream?: boolean;
  } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: options.env ?? process.env
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = options.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs)
      : undefined;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      if (options.stream) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      if (options.stream) process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      if (options.allowFail)
        resolvePromise({ code: 1, stdout: "", stderr: String(error) });
      else rejectPromise(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const result = {
        code: code ?? 0,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
      if (code === 0 || options.allowFail) resolvePromise(result);
      else rejectPromise(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

type K6Summary = {
  metrics?: Record<string, Record<string, unknown> & { values?: Record<string, number> }>;
};

function metric(summary: K6Summary, name: string, key: string): number {
  const value = summary.metrics?.[name];
  if (!value) return 0;
  const direct = value[key];
  if (typeof direct === "number") return direct;
  const nested = value.values?.[key];
  if (typeof nested === "number") return nested;
  if (key === "rate" && typeof value.value === "number") return value.value;
  return 0;
}

function ndjson(stdout: string): Array<Record<string, unknown>> {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("["))
    return JSON.parse(trimmed) as Array<Record<string, unknown>>;
  return trimmed
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 3000
): Promise<{ ok: boolean }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return { ok: true };
    await sleep(intervalMs);
  }
  return { ok: false };
}

function parseModes(value: string | undefined, fallback: ModeId[]): ModeId[] {
  const all: ModeId[] = [
    "baseline",
    "metrics",
    "metrics_logs",
    "metrics_logs_traces",
    "otel_full"
  ];
  if (!value) return fallback;
  const requested = value.split(",").map((part) => part.trim());
  return all.filter((mode) => requested.includes(mode));
}

function parseRates(value: string | undefined, fallback: number[]): number[] {
  if (!value) return fallback;
  const parsed = value
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  return parsed.length ? parsed : fallback;
}

function parsePercent(value: string): number {
  return Number(value.replace("%", "")) || 0;
}

function parseMemoryBytes(value: string): number {
  const amount = value.split("/")[0]?.trim() ?? "0B";
  const match = /^([\d.]+)\s*([KMGT]?i?B|B)$/.exec(amount);
  if (!match) return 0;
  const multipliers: Record<string, number> = {
    B: 1,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3
  };
  return Number(match[1]) * (multipliers[match[2]] ?? 1);
}

function parseSeconds(value: string): number {
  const match = /^(\d+)(s|m)?$/.exec(value.trim());
  if (!match) return 15;
  return match[2] === "m" ? Number(match[1]) * 60 : Number(match[1]);
}

function mean(values: number[]): number {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? `${fallback}`, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

void main();
