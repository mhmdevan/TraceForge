import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderBarChart } from "./lib/svg-chart";

// Objective Mean-Time-To-Detect (MTTD) for RQ2.
//
// Instead of a subjective single-operator timing, this measures detection
// objectively: the time from fault onset (traffic start, T0) to the relevant
// Prometheus alert (a) first becoming active/pending and (b) firing. The baseline
// mode has no metrics pipeline, so automated detection is impossible — a strong,
// objective contrast. Everything runs in-network (alerts polled via a curl
// container; ephemeral host ports) to avoid host-port conflicts.

type ModeId = "baseline" | "metrics";

type Scenario = {
  id: string;
  label: string;
  fault: Record<string, string>;
  alert: string;
  symptom: string;
};

type Result = {
  scenario: Scenario;
  mode: ModeId;
  detected: boolean;
  timeToPendingS: number | null;
  timeToFiringS: number | null;
  observedErrorRate: number | null;
  observedP95Ms: number | null;
};

const SCENARIOS: Scenario[] = [
  {
    id: "F2",
    label: "Payment 500 errors",
    fault: { PAYMENT_ERROR_RATE: "0.3" },
    alert: "TraceForgeHttpErrors",
    symptom: "error-rate spike"
  },
  {
    id: "F1",
    label: "Slow payment",
    fault: { PAYMENT_MODE: "slow", PAYMENT_DELAY_MS: "1000" },
    alert: "TraceForgeHighP95Latency",
    symptom: "high p95 latency"
  },
  {
    id: "F3",
    label: "Slow DB query",
    fault: { DB_SLOW_QUERY: "true", DB_SLOW_QUERY_DELAY_MS: "500" },
    alert: "TraceForgeHighP95Latency",
    symptom: "high p95 latency"
  }
];

const MODE_PROFILES: Record<ModeId, string[]> = {
  baseline: [],
  metrics: ["metrics"]
};

const workspaceRoot = process.cwd();
const composeFile = resolve(
  workspaceRoot,
  "infra/docker/compose/docker-compose.base.yml"
);
const k6Dir = resolve(workspaceRoot, "load-tests", "k6");
const composeNetwork = "observable-microservice-lab_traceforge";
const k6Image = process.env.K6_IMAGE ?? "grafana/k6:0.54.0";
const curlImage = process.env.CURL_IMAGE ?? "curlimages/curl:8.11.1";
const k6ContainerName = "traceforge-mttd-k6";
const rate = toInt(process.env.RATE, 30);
const detectTimeoutS = toInt(process.env.MTTD_TIMEOUT_S, 160);
const baselineWindowS = toInt(process.env.MTTD_BASELINE_WINDOW_S, 30);
const coreServices = [
  "api-gateway",
  "transaction-service",
  "payment-service",
  "worker-service",
  "postgres",
  "redis",
  "rabbitmq"
];
const scenarios = parseScenarios(process.env.MTTD_SCENARIOS);

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const rawRoot = resolve(workspaceRoot, "results", "raw", `mttd-${timestamp}`);
const processedDir = resolve(workspaceRoot, "results", "processed");
const chartsDir = resolve(workspaceRoot, "results", "charts");
const reportPath = resolve(workspaceRoot, "docs", "mttd-report.md");

async function main(): Promise<void> {
  await mkdir(rawRoot, { recursive: true });
  await mkdir(processedDir, { recursive: true });
  await mkdir(chartsDir, { recursive: true });

  console.log(
    `MTTD: scenarios=[${scenarios.map((s) => s.id).join(", ")}] modes=[baseline, metrics] ` +
      `rate=${rate}rps timeout=${detectTimeoutS}s`
  );

  // Build images from current source so the fault-injection code is actually present
  // (a stale `:latest` image would silently ignore the fault env).
  console.log("Building service images from current source...");
  await compose(["build"], { allowFail: true, timeoutMs: 600000, stream: true });

  const results: Result[] = [];
  for (const scenario of scenarios) {
    results.push(await runCase(scenario, "baseline"));
    results.push(await runCase(scenario, "metrics"));
  }

  await writeCsv(results);
  const charts = await writeCharts(results);
  await writeReport(results, charts);

  console.log(`\nCSV: ${resolve(processedDir, "mttd-results.csv")}`);
  console.log(`Charts: ${charts.join(", ")}`);
  console.log(`Report: ${reportPath}`);
}

async function runCase(scenario: Scenario, mode: ModeId): Promise<Result> {
  console.log(`\n===== ${scenario.id} (${scenario.label}) / ${mode} =====`);
  const env = composeEnv(mode, scenario.fault);

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
    console.log(`  ${scenario.id}/${mode}: core not healthy; recording as not detected.`);
    await compose(["down", "--remove-orphans"], {
      env,
      allowFail: true,
      timeoutMs: 120000
    });
    return notDetected(scenario, mode);
  }
  await ensureSchema(env);

  const result =
    mode === "metrics"
      ? await measureMetrics(scenario, mode)
      : await measureBaseline(scenario, mode);

  await run("docker", ["rm", "-f", k6ContainerName], { allowFail: true });
  await compose(["down", "--remove-orphans"], {
    env,
    allowFail: true,
    timeoutMs: 120000
  });
  return result;
}

async function measureMetrics(scenario: Scenario, mode: ModeId): Promise<Result> {
  // Wait for Prometheus to be ready and scraping before starting the fault clock.
  const ready = await waitUntil(() => prometheusReady(), 90000);
  if (!ready.ok) {
    console.log(`  ${scenario.id}: Prometheus did not become ready.`);
    return notDetected(scenario, mode);
  }
  await sleep(6000); // allow at least one scrape of the (faulty) services

  await startBackgroundLoad(`${detectTimeoutS + 20}s`);
  const t0 = Date.now();
  console.log(`  load started; polling for alert "${scenario.alert}"...`);

  let pendingS: number | null = null;
  let firingS: number | null = null;
  const deadline = t0 + detectTimeoutS * 1000;
  while (Date.now() < deadline) {
    const alert = await activeAlert(scenario.alert);
    if (alert) {
      if (pendingS === null) {
        const activeAtMs = Date.parse(alert.activeAt ?? "");
        pendingS = Number.isFinite(activeAtMs)
          ? Math.max(0, (activeAtMs - t0) / 1000)
          : (Date.now() - t0) / 1000;
        console.log(`  alert active (pending) at ~${pendingS.toFixed(1)}s`);
      }
      if (alert.state === "firing") {
        firingS = (Date.now() - t0) / 1000;
        console.log(`  alert FIRING at ${firingS.toFixed(1)}s`);
        break;
      }
    }
    await sleep(3000);
  }

  await writeFile(
    resolve(rawRoot, `alerts-${scenario.id}-${mode}.json`),
    `${JSON.stringify({ t0, pendingS, firingS }, null, 2)}\n`
  );

  return {
    scenario,
    mode,
    detected: firingS !== null,
    timeToPendingS: pendingS,
    timeToFiringS: firingS,
    observedErrorRate: null,
    observedP95Ms: null
  };
}

async function measureBaseline(scenario: Scenario, mode: ModeId): Promise<Result> {
  // No Prometheus in baseline → automated detection is impossible. We still drive
  // load briefly to confirm the fault is actually degrading the system (k6 sees it),
  // which substantiates "the problem is real but invisible without observability".
  const summaryFile = `k6-${scenario.id}-baseline.json`;
  await runK6Foreground(`${baselineWindowS}s`, summaryFile);
  let errorRate: number | null = null;
  let p95: number | null = null;
  try {
    const summary = JSON.parse(
      await readFile(resolve(rawRoot, summaryFile), "utf8")
    ) as K6Summary;
    errorRate = metric(summary, "http_req_failed", "rate");
    p95 = metric(summary, "http_req_duration", "p(95)");
  } catch {
    /* leave null */
  }
  console.log(
    `  baseline: no metrics pipeline -> undetected. k6 observed error_rate=${errorRate?.toFixed(3)} p95=${p95?.toFixed(1)}ms`
  );

  return {
    scenario,
    mode,
    detected: false,
    timeToPendingS: null,
    timeToFiringS: null,
    observedErrorRate: errorRate,
    observedP95Ms: p95
  };
}

function notDetected(scenario: Scenario, mode: ModeId): Result {
  return {
    scenario,
    mode,
    detected: false,
    timeToPendingS: null,
    timeToFiringS: null,
    observedErrorRate: null,
    observedP95Ms: null
  };
}

// --- Prometheus + k6 ----------------------------------------------------------

async function prometheusReady(): Promise<boolean> {
  const out = await curl("/-/ready");
  return out.includes("Ready");
}

type PromAlert = { labels?: { alertname?: string }; state?: string; activeAt?: string };

async function activeAlert(alertname: string): Promise<PromAlert | undefined> {
  const body = await curl("/api/v1/alerts");
  if (!body.trim().startsWith("{")) {
    return undefined;
  }
  const payload = JSON.parse(body) as { data?: { alerts?: PromAlert[] } };
  return (payload.data?.alerts ?? []).find((a) => a.labels?.alertname === alertname);
}

async function curl(path: string): Promise<string> {
  const result = await run(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      composeNetwork,
      curlImage,
      "-s",
      `http://prometheus:9090${path}`
    ],
    { allowFail: true, timeoutMs: 30000 }
  );
  return result.stdout;
}

async function startBackgroundLoad(duration: string): Promise<void> {
  await run("docker", ["rm", "-f", k6ContainerName], { allowFail: true });
  await run(
    "docker",
    [
      "run",
      "-d",
      "--name",
      k6ContainerName,
      "--network",
      composeNetwork,
      "-v",
      `${k6Dir}:/scripts:ro`,
      k6Image,
      "run",
      "-e",
      "BASE_URL=http://api-gateway:3000",
      "-e",
      `RATE=${rate}`,
      "-e",
      `DURATION=${duration}`,
      "/scripts/constant-rate.js"
    ],
    { allowFail: true, timeoutMs: 60000 }
  );
}

async function runK6Foreground(duration: string, summaryFile: string): Promise<void> {
  await run(
    "docker",
    [
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
      "--summary-export",
      `/results/${summaryFile}`,
      "-e",
      "BASE_URL=http://api-gateway:3000",
      "-e",
      `RATE=${rate}`,
      "-e",
      `DURATION=${duration}`,
      "/scripts/constant-rate.js"
    ],
    { allowFail: true, timeoutMs: 300000 }
  );
}

// --- compose helpers ----------------------------------------------------------

function composeEnv(mode: ModeId, fault: Record<string, string>): NodeJS.ProcessEnv {
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
    GRAFANA_PORT: "0"
  };
  return {
    ...process.env,
    ...ephemeral,
    OBS_MODE: mode === "metrics" ? "metrics" : "none",
    ...fault
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

// --- outputs ------------------------------------------------------------------

async function writeCsv(results: Result[]): Promise<void> {
  const header = [
    "scenario",
    "label",
    "alert",
    "mode",
    "detected",
    "time_to_pending_s",
    "time_to_firing_s",
    "observed_error_rate",
    "observed_p95_ms"
  ].join(",");
  const rows = results.map((r) =>
    [
      r.scenario.id,
      csv(r.scenario.label),
      r.scenario.alert,
      r.mode,
      r.detected ? "yes" : "no",
      r.timeToPendingS === null ? "" : round(r.timeToPendingS, 1),
      r.timeToFiringS === null ? "" : round(r.timeToFiringS, 1),
      r.observedErrorRate === null ? "" : round(r.observedErrorRate, 4),
      r.observedP95Ms === null ? "" : round(r.observedP95Ms, 1)
    ].join(",")
  );
  await writeFile(
    resolve(processedDir, "mttd-results.csv"),
    `${[header, ...rows].join("\n")}\n`
  );
}

async function writeCharts(results: Result[]): Promise<string[]> {
  const metricsResults = scenarios.map((scenario) =>
    results.find((r) => r.scenario.id === scenario.id && r.mode === "metrics")
  );
  const file = "mttd-detection.svg";
  await writeFile(
    resolve(chartsDir, file),
    renderBarChart({
      title: "Objective MTTD by Fault — metrics mode (baseline never detects)",
      subtitle:
        "Seconds from fault onset to Prometheus alert; baseline has no metrics pipeline",
      categories: scenarios.map((s) => s.id),
      yAxisLabel: "seconds",
      format: (value) => value.toFixed(0),
      series: [
        {
          name: "time-to-pending",
          color: "#f28e2b",
          values: metricsResults.map((r) => r?.timeToPendingS ?? 0)
        },
        {
          name: "time-to-firing",
          color: "#e15759",
          values: metricsResults.map((r) => r?.timeToFiringS ?? 0)
        }
      ]
    })
  );
  return [file];
}

async function writeReport(results: Result[], charts: string[]): Promise<void> {
  const lines: string[] = [];
  lines.push("# Objective Mean-Time-To-Detect (RQ2)");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push(
    "Detection is measured objectively, with no human in the loop: each fault is " +
      "injected into a freshly started stack, a constant-arrival-rate load is applied " +
      "at a recorded `T0`, and the relevant Prometheus alert is polled until it becomes " +
      "**active (pending)** and then **firing**. MTTD is the elapsed time from `T0`. The " +
      "**baseline** mode has no metrics pipeline, so no alert can ever fire — automated " +
      "detection is impossible by construction. This isolates the *detection* half of " +
      "debuggability; *root-cause* time (which logs and traces accelerate) is a separate " +
      "measurement (see `failure-injection-protocol.md`)."
  );
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push(
    "| Fault | Mode | Alert | Detected | Time→pending (s) | Time→firing (s) | Baseline symptom (k6) |"
  );
  lines.push("| --- | --- | --- | --- | ---: | ---: | --- |");
  for (const r of results) {
    const symptom =
      r.mode === "baseline" && (r.observedErrorRate !== null || r.observedP95Ms !== null)
        ? `err=${(r.observedErrorRate ?? 0).toFixed(2)}, p95=${(r.observedP95Ms ?? 0).toFixed(0)}ms`
        : "—";
    lines.push(
      `| ${r.scenario.id} ${r.scenario.label} | ${r.mode} | ${r.scenario.alert} | ` +
        `${r.detected ? "✅ yes" : "❌ no"} | ${r.timeToPendingS === null ? "—" : r.timeToPendingS.toFixed(1)} | ` +
        `${r.timeToFiringS === null ? "—" : r.timeToFiringS.toFixed(1)} | ${symptom} |`
    );
  }
  lines.push("");

  lines.push("## Figure");
  lines.push("");
  for (const chart of charts) {
    lines.push(`![${chart}](../results/charts/${chart})`);
    lines.push("");
  }

  lines.push("## Finding");
  lines.push("");
  lines.push(
    "- **Step change, not a gradient.** Without observability the fault is real (k6 " +
      "records the degraded error rate / latency) yet **undetectable by any automated " +
      "means**. The metrics pipeline converts this into detection within a bounded, " +
      "configurable time."
  );
  lines.push(
    "- **Detection latency is dominated by alert configuration**, not observability " +
      "depth: time-to-pending tracks the scrape interval, and time-to-firing adds the " +
      "alert's `for:` debounce. Metrics, logs, and traces share the same metric-based " +
      "alerts, so they detect equally fast; the additional value of logs/traces is in " +
      "root-cause, measured separately."
  );
  lines.push("");
  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push(
    "pnpm mttd:run   # requires Docker; uses the metrics Compose profile + Prometheus alerts"
  );
  lines.push("```");
  lines.push("");
  await writeFile(reportPath, lines.join("\n"));
}

// --- low-level ----------------------------------------------------------------

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

function parseScenarios(value: string | undefined): Scenario[] {
  if (!value) return SCENARIOS;
  const ids = value.split(",").map((part) => part.trim());
  return SCENARIOS.filter((s) => ids.includes(s.id));
}

function csv(value: string): string {
  return value.includes(",") ? `"${value}"` : value;
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
