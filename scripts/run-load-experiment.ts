import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Realistic load harness for ISI-grade overhead measurement.
//
// Improvements over the early micro-benchmark runs:
//   - Open-model load: a constant ARRIVAL RATE (rps), not fixed VUs.
//   - Warm-up phase discarded; only the steady-state window is measured.
//   - N >= 10 repetitions per mode (default 10).
//   - Randomized mode order (seeded) to avoid confounding mode with time/thermal drift.
//
// Everything runs inside the compose network (k6 by DNS, schema via `exec`,
// readiness via `compose ps`), and host ports are published as ephemeral (0), so
// repeated up/down cycles never hit host-port conflicts. Output per-mode CSVs
// (results/processed/load-<mode>-summary.csv) feed pnpm stats:report STATS_DATASET=load.

type ModeId =
  | "baseline"
  | "metrics"
  | "metrics_logs"
  | "metrics_logs_traces"
  | "otel_full";

type RepResult = {
  rep: number;
  httpRequests: number;
  errorRate: number;
  checkRate: number;
  durationAvgMs: number;
  durationP50Ms: number;
  durationP95Ms: number;
  durationP99Ms: number;
  avgCpuPercent: number;
  maxMemoryBytes: number;
  achievedRps: number;
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

const modes = parseModes(process.env.LOAD_MODES);
const reps = toInt(process.env.LOAD_REPS, 10);
const rate = toInt(process.env.RATE, 150);
const duration = process.env.DURATION ?? "30s";
const warmup = process.env.WARMUP ?? "10s";
const seed = toInt(process.env.LOAD_SEED, 7);
const measureSeconds = parseSeconds(duration);

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const rawRoot = resolve(workspaceRoot, "results", "raw", `load-${timestamp}`);
const processedDir = resolve(workspaceRoot, "results", "processed");

async function main(): Promise<void> {
  await mkdir(rawRoot, { recursive: true });
  await mkdir(processedDir, { recursive: true });

  const order = shuffle(modes, mulberry32(seed));
  console.log(
    `Load harness: modes=[${order.join(", ")}] reps=${reps} rate=${rate}rps ` +
      `measure=${duration} warmup=${warmup} (randomized order, seed ${seed})`
  );

  const manifest: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    reps,
    rate,
    duration,
    warmup,
    seed,
    modeOrder: order
  };
  await writeFile(
    resolve(rawRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  // Build images from current source so each mode runs current code, not a stale
  // `:latest` (otherwise OBS_MODE/instrumentation changes would not take effect).
  console.log("Building service images from current source...");
  await compose(["build"], { allowFail: true, timeoutMs: 600000, stream: true });

  for (const mode of order) {
    await runMode(mode);
  }

  console.log(`\nDone. Per-mode CSVs under ${processedDir} (load-<mode>-summary.csv).`);
  console.log("Analyze with: STATS_DATASET=load pnpm stats:report");
}

async function runMode(mode: ModeId): Promise<void> {
  console.log(`\n===== ${mode} =====`);
  const profiles = MODE_PROFILES[mode];
  const env = composeEnv(mode);

  await compose(["down", "--remove-orphans"], {
    env,
    allowFail: true,
    timeoutMs: 120000
  });
  await compose([...profileArgs(profiles), "up", "-d"], {
    env,
    allowFail: true,
    timeoutMs: 300000,
    stream: true
  });

  const healthy = await waitUntil(() => coreHealthy(env), 240000);
  if (!healthy.ok) {
    console.log(`  ${mode}: core services did not become healthy; skipping.`);
    await compose(["down", "--remove-orphans"], {
      env,
      allowFail: true,
      timeoutMs: 120000
    });
    return;
  }

  // Ensure schema (idempotent) inside the container — no host port needed.
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

  // Warm-up (discarded).
  console.log(`  ${mode}: warm-up (${warmup})...`);
  await runK6(mode, "warmup", warmup);

  const results: RepResult[] = [];
  for (let rep = 1; rep <= reps; rep += 1) {
    const result = await measureRep(mode, rep);
    if (result) {
      results.push(result);
      console.log(
        `  ${mode} rep ${rep}/${reps}: p95=${result.durationP95Ms.toFixed(1)}ms ` +
          `cpu=${result.avgCpuPercent.toFixed(1)}% rps=${result.achievedRps.toFixed(0)}`
      );
    }
  }

  await writeModeCsv(mode, results);
  await compose(["down", "--remove-orphans"], {
    env,
    allowFail: true,
    timeoutMs: 120000
  });
}

async function measureRep(mode: ModeId, rep: number): Promise<RepResult | null> {
  const samples: Array<{ cpu: number; mem: number }> = [];
  const sampler = setInterval(() => {
    void sampleDockerStats(samples);
  }, 1000);

  const summaryFile = `k6-${mode}-rep-${rep}.json`;
  try {
    await runK6(mode, `rep-${rep}`, duration, summaryFile);
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
    rep,
    httpRequests,
    errorRate: metric(summary, "http_req_failed", "rate"),
    checkRate: metric(summary, "checks", "rate"),
    durationAvgMs: metric(summary, "http_req_duration", "avg"),
    durationP50Ms: metric(summary, "http_req_duration", "med"),
    durationP95Ms: metric(summary, "http_req_duration", "p(95)"),
    durationP99Ms: metric(summary, "http_req_duration", "p(99)"),
    avgCpuPercent: samples.length ? mean(samples.map((s) => s.cpu)) : 0,
    maxMemoryBytes: samples.length ? Math.max(...samples.map((s) => s.mem)) : 0,
    achievedRps: measureSeconds > 0 ? httpRequests / measureSeconds : 0
  };
}

function runK6(
  mode: ModeId,
  label: string,
  dur: string,
  summaryFile?: string
): Promise<void> {
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
    "/scripts/constant-rate.js"
  ];
  return run("docker", args, { allowFail: true, timeoutMs: 300000 }).then(
    () => undefined
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

async function coreHealthy(env: NodeJS.ProcessEnv): Promise<boolean> {
  const result = await compose(["ps", "--format", "json"], { env, allowFail: true });
  const entries = ndjson(result.stdout);
  const healthyCore = coreServices.filter((service) =>
    entries.some(
      (entry) => entry.Service === service && String(entry.Health ?? "") === "healthy"
    )
  );
  return healthyCore.length === coreServices.length;
}

async function writeModeCsv(mode: ModeId, results: RepResult[]): Promise<void> {
  const header = [
    "run",
    "status",
    "k6_mode",
    "http_requests",
    "error_rate",
    "check_rate",
    "duration_avg_ms",
    "duration_p50_ms",
    "duration_p95_ms",
    "duration_p99_ms",
    "avg_cpu_percent",
    "max_memory_bytes",
    "offered_rps",
    "achieved_rps"
  ].join(",");

  const rows = results.map((r) =>
    [
      r.rep,
      "passed",
      "docker",
      r.httpRequests,
      r.errorRate,
      r.checkRate,
      r.durationAvgMs,
      r.durationP50Ms,
      r.durationP95Ms,
      r.durationP99Ms,
      r.avgCpuPercent,
      r.maxMemoryBytes,
      rate,
      round(r.achievedRps, 2)
    ].join(",")
  );

  await writeFile(
    resolve(processedDir, `load-${mode}-summary.csv`),
    `${[header, ...rows].join("\n")}\n`
  );
  console.log(`  ${mode}: wrote ${results.length} reps -> load-${mode}-summary.csv`);
}

// --- compose / docker helpers -------------------------------------------------

function composeEnv(mode: ModeId): NodeJS.ProcessEnv {
  // Ephemeral host ports (0) so up/down cycles never collide on leaked bindings.
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
      if (options.stream) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      if (options.stream) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      if (options.allowFail) {
        resolvePromise({ code: 1, stdout: "", stderr: String(error) });
      } else {
        rejectPromise(error);
      }
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const result = {
        code: code ?? 0,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
      if (code === 0 || options.allowFail) {
        resolvePromise(result);
      } else {
        rejectPromise(new Error(`${command} ${args.join(" ")} exited ${code}`));
      }
    });
  });
}

type K6Summary = {
  metrics?: Record<string, Record<string, unknown> & { values?: Record<string, number> }>;
};

function metric(summary: K6Summary, name: string, key: string): number {
  const value = summary.metrics?.[name];
  if (!value) {
    return 0;
  }
  const direct = value[key];
  if (typeof direct === "number") {
    return direct;
  }
  const nested = value.values?.[key];
  if (typeof nested === "number") {
    return nested;
  }
  if (key === "rate" && typeof value.value === "number") {
    return value.value;
  }
  return 0;
}

function ndjson(stdout: string): Array<Record<string, unknown>> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as Array<Record<string, unknown>>;
  }
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
    if (await predicate()) {
      return { ok: true };
    }
    await sleep(intervalMs);
  }
  return { ok: false };
}

function parseModes(value: string | undefined): ModeId[] {
  const all: ModeId[] = [
    "baseline",
    "metrics",
    "metrics_logs",
    "metrics_logs_traces",
    "otel_full"
  ];
  if (!value) {
    return all;
  }
  const requested = value.split(",").map((part) => part.trim());
  return all.filter((mode) => requested.includes(mode));
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function mulberry32(a: number): () => number {
  let state = a >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parsePercent(value: string): number {
  return Number(value.replace("%", "")) || 0;
}

function parseMemoryBytes(value: string): number {
  const amount = value.split("/")[0]?.trim() ?? "0B";
  const match = /^([\d.]+)\s*([KMGT]?i?B|B)$/.exec(amount);
  if (!match) {
    return 0;
  }
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
  if (!match) {
    return 30;
  }
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
