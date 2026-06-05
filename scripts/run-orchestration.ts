import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderBarChart } from "./lib/svg-chart";

// Phase 12 — Docker Compose vs Swarm vs Kubernetes orchestration comparison.
//
// Measures startup time, scaling behaviour, failure recovery, and resource
// overhead for the Compose and Swarm targets on the same core stack, and
// computes configuration-size metrics from the actual config files. Kubernetes
// manifests are authored and statically validated but not run here (no local
// cluster); their config metrics are still included. Every runtime number comes
// from a real deployment.

type ScalingEvent = {
  service: string;
  from: number;
  to: number;
  seconds: number | null;
  note: string;
};
type RecoveryEvent = { service: string; seconds: number | null; note: string };

type TargetRuntime = {
  target: string;
  startupSeconds: number | null;
  avgCpuPercent: number;
  maxMemoryBytes: number;
  scaling: ScalingEvent[];
  recovery: RecoveryEvent[];
  notes: string[];
};

type ConfigMetric = {
  target: string;
  files: number;
  bytes: number;
  lines: number;
  resources: number;
};

const workspaceRoot = process.cwd();
const composeFile = resolve(
  workspaceRoot,
  "infra/docker/compose/docker-compose.base.yml"
);
const swarmFile = resolve(workspaceRoot, "infra/docker/swarm/docker-stack.yml");
const k8sFile = resolve(workspaceRoot, "infra/docker/kubernetes/traceforge.yaml");

const composeProject = "observable-microservice-lab";
const swarmStack = "traceforge";
const coreServices = [
  "api-gateway",
  "transaction-service",
  "payment-service",
  "worker-service",
  "postgres",
  "redis",
  "rabbitmq"
];

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const rawDir = resolve(workspaceRoot, "results", "raw", `orchestration-${timestamp}`);
const processedDir = resolve(workspaceRoot, "results", "processed");
const chartsDir = resolve(workspaceRoot, "results", "charts");
const reportPath = resolve(workspaceRoot, "docs", "orchestration-comparison.md");

async function main(): Promise<void> {
  await mkdir(rawDir, { recursive: true });
  await mkdir(processedDir, { recursive: true });
  await mkdir(chartsDir, { recursive: true });

  const config = await configMetrics();
  const compose = await measureCompose();
  const swarm = await measureSwarm();

  const runtimes = [compose, swarm];
  await writeFile(
    resolve(rawDir, "runtime.json"),
    `${JSON.stringify({ config, runtimes }, null, 2)}\n`
  );
  await writeCsv(runtimes, config);
  const charts = await writeCharts(runtimes, config);
  await writeReport(runtimes, config, charts);

  console.log(`\nRaw runtime: ${resolve(rawDir, "runtime.json")}`);
  console.log(`Processed CSV: ${resolve(processedDir, "orchestration-comparison.csv")}`);
  console.log(`Charts: ${charts.join(", ")}`);
  console.log(`Report: ${reportPath}`);
}

// --- Compose target -----------------------------------------------------------

async function measureCompose(): Promise<TargetRuntime> {
  const notes: string[] = [];
  console.log("== Compose ==");

  await run(["docker", "compose", "-f", composeFile, "down", "--remove-orphans"], {
    allowFail: true,
    timeoutMs: 120000
  });

  const startedAt = Date.now();
  await run(["docker", "compose", "-f", composeFile, "up", "-d"], {
    allowFail: true,
    timeoutMs: 300000,
    stream: true
  });
  const startup = await waitUntil(async () => composeAllHealthy(), 240000);
  const startupSeconds = startup.ok ? (Date.now() - startedAt) / 1000 : null;
  console.log(`Compose startup: ${startupSeconds ?? "timed out"}s`);

  const stats = await dockerStats((name) => name.startsWith(`${composeProject}-`));

  // Recovery probe FIRST (before scaling, so a failed scale-up cannot leave a
  // spurious container that confuses the check): Compose is not a reconciler, so
  // a killed container is not restarted. We inspect the exact killed container.
  const recovery: RecoveryEvent[] = [];
  const target = await firstRunningContainer(`${composeProject}-payment-service`);
  if (target) {
    await run(["docker", "kill", target], { allowFail: true });
    await sleep(8000);
    const state = await containerState(target);
    recovery.push({
      service: "payment-service",
      seconds: null,
      note:
        state === "running"
          ? "restarted automatically"
          : `no automatic recovery: container stayed "${state}" (Compose does not reconcile desired state; manual \`up -d\` required)`
    });
    // Restore a clean stack before the scaling probe.
    await run(["docker", "compose", "-f", composeFile, "up", "-d"], {
      allowFail: true,
      timeoutMs: 120000
    });
  }

  // Scaling probe: services publish fixed host ports, so a second replica conflicts.
  const scaleResult = await run(
    ["docker", "compose", "-f", composeFile, "up", "-d", "--scale", "payment-service=2"],
    { allowFail: true, timeoutMs: 60000 }
  );
  const scaling: ScalingEvent[] = [
    {
      service: "payment-service",
      from: 1,
      to: 2,
      seconds: null,
      note:
        scaleResult.code === 0
          ? "scaled (unexpected — host port would normally conflict)"
          : "failed: published host port conflict (Compose maps a fixed host port per service)"
    }
  ];

  notes.push(
    "Compose is a single-host developer tool: no reconciliation loop and host-port " +
      "publishing limits horizontal scaling of the same service."
  );

  await run(["docker", "compose", "-f", composeFile, "down", "--remove-orphans"], {
    allowFail: true,
    timeoutMs: 120000
  });

  return {
    target: "Docker Compose",
    startupSeconds,
    avgCpuPercent: stats.avgCpuPercent,
    maxMemoryBytes: stats.maxMemoryBytes,
    scaling,
    recovery,
    notes
  };
}

async function composeAllHealthy(): Promise<boolean> {
  const result = await run(
    ["docker", "compose", "-f", composeFile, "ps", "--format", "json"],
    {
      allowFail: true
    }
  );
  const entries = ndjson(result.stdout);
  if (entries.length < coreServices.length) {
    return false;
  }
  return entries.every((entry) => {
    const health = String(entry.Health ?? "");
    const state = String(entry.State ?? "");
    return health === "healthy" || (health === "" && state === "running");
  });
}

// --- Swarm target -------------------------------------------------------------

async function measureSwarm(): Promise<TargetRuntime> {
  const notes: string[] = [];
  console.log("== Swarm ==");

  for (const service of [
    "api-gateway",
    "transaction-service",
    "payment-service",
    "worker-service"
  ]) {
    await run(
      [
        "docker",
        "tag",
        `${composeProject}_${service}:latest`,
        `traceforge-${service}:latest`
      ],
      { allowFail: true }
    );
  }

  await run(["docker", "swarm", "init"], { allowFail: true });

  const startedAt = Date.now();
  await run(
    [
      "docker",
      "stack",
      "deploy",
      "-c",
      swarmFile,
      "--resolve-image",
      "never",
      swarmStack
    ],
    { allowFail: true, timeoutMs: 120000, stream: true }
  );
  const startup = await waitUntil(async () => swarmConverged(), 300000);
  const startupSeconds = startup.ok ? (Date.now() - startedAt) / 1000 : null;
  console.log(`Swarm startup: ${startupSeconds ?? "timed out"}s`);

  const stats = await dockerStats((name) => name.startsWith(`${swarmStack}_`));

  const scaling: ScalingEvent[] = [];
  scaling.push(await swarmScale("transaction-service", 1, 3));
  scaling.push(await swarmScale("payment-service", 1, 2));

  const recovery: RecoveryEvent[] = [];
  recovery.push(await swarmRecover("transaction-service", 3));
  recovery.push(await swarmRecover("payment-service", 2));

  notes.push(
    "Swarm reconciles desired state: scaling uses the routing mesh on a single " +
      "published port, and killed tasks are automatically rescheduled."
  );

  await run(["docker", "stack", "rm", swarmStack], { allowFail: true, timeoutMs: 60000 });
  await sleep(8000);
  await run(["docker", "swarm", "leave", "--force"], { allowFail: true });

  return {
    target: "Docker Swarm",
    startupSeconds,
    avgCpuPercent: stats.avgCpuPercent,
    maxMemoryBytes: stats.maxMemoryBytes,
    scaling,
    recovery,
    notes
  };
}

async function swarmConverged(): Promise<boolean> {
  const replicas = await swarmReplicas();
  return (
    replicas.size >= coreServices.length &&
    [...replicas.values()].every((r) => r.running >= r.desired && r.desired > 0)
  );
}

async function swarmReplicas(): Promise<
  Map<string, { running: number; desired: number }>
> {
  const result = await run(
    [
      "docker",
      "service",
      "ls",
      "--filter",
      `name=${swarmStack}`,
      "--format",
      "{{.Name}} {{.Replicas}}"
    ],
    { allowFail: true }
  );
  const map = new Map<string, { running: number; desired: number }>();
  for (const line of result.stdout.split("\n").filter(Boolean)) {
    const [name, replicas] = line.trim().split(/\s+/);
    const match = /(\d+)\/(\d+)/.exec(replicas ?? "");
    if (match) {
      map.set(name, { running: Number(match[1]), desired: Number(match[2]) });
    }
  }
  return map;
}

async function swarmScale(
  service: string,
  from: number,
  to: number
): Promise<ScalingEvent> {
  const fullName = `${swarmStack}_${service}`;
  const startedAt = Date.now();
  await run(["docker", "service", "scale", `${fullName}=${to}`], {
    allowFail: true,
    timeoutMs: 60000
  });
  const ok = await waitUntil(async () => {
    const r = (await swarmReplicas()).get(fullName);
    return Boolean(r && r.running === to);
  }, 120000);
  const seconds = ok.ok ? (Date.now() - startedAt) / 1000 : null;
  console.log(`Swarm scale ${service} ${from}->${to}: ${seconds ?? "timed out"}s`);
  return {
    service,
    from,
    to,
    seconds,
    note: ok.ok ? "scaled via routing mesh" : "scaling timed out"
  };
}

async function swarmRecover(service: string, desired: number): Promise<RecoveryEvent> {
  const fullName = `${swarmStack}_${service}`;
  const container = await firstRunningContainer(fullName);
  if (!container) {
    return { service, seconds: null, note: "no running task found to kill" };
  }

  const startedAt = Date.now();
  await run(["docker", "kill", container], { allowFail: true });
  const ok = await waitUntil(async () => {
    const r = (await swarmReplicas()).get(fullName);
    return Boolean(r && r.running === desired && r.desired === desired);
  }, 120000);
  const seconds = ok.ok ? (Date.now() - startedAt) / 1000 : null;
  console.log(`Swarm recover ${service}: ${seconds ?? "timed out"}s`);
  return {
    service,
    seconds,
    note: ok.ok ? "task automatically rescheduled" : "recovery timed out"
  };
}

// --- shared docker helpers ----------------------------------------------------

async function dockerStats(
  match: (name: string) => boolean
): Promise<{ avgCpuPercent: number; maxMemoryBytes: number }> {
  const samples: Array<{ cpu: number; mem: number }> = [];
  for (let i = 0; i < 3; i += 1) {
    const result = await run(
      ["docker", "stats", "--no-stream", "--format", "{{json .}}"],
      {
        allowFail: true
      }
    );
    for (const entry of ndjson(result.stdout)) {
      const name = String(entry.Name ?? "");
      if (match(name)) {
        samples.push({
          cpu: parsePercent(String(entry.CPUPerc ?? "0%")),
          mem: parseMemoryBytes(String(entry.MemUsage ?? "0B"))
        });
      }
    }
    await sleep(1000);
  }
  if (samples.length === 0) {
    return { avgCpuPercent: 0, maxMemoryBytes: 0 };
  }
  return {
    avgCpuPercent: mean(samples.map((s) => s.cpu)),
    maxMemoryBytes: Math.max(...samples.map((s) => s.mem))
  };
}

async function containerState(name: string): Promise<string> {
  const result = await run(["docker", "inspect", "-f", "{{.State.Status}}", name], {
    allowFail: true
  });
  return result.stdout.trim() || "absent";
}

async function firstRunningContainer(prefix: string): Promise<string | undefined> {
  const result = await run(
    ["docker", "ps", "--filter", `name=${prefix}`, "--format", "{{.Names}}"],
    { allowFail: true }
  );
  return result.stdout.split("\n").filter(Boolean)[0];
}

// --- config metrics -----------------------------------------------------------

async function configMetrics(): Promise<ConfigMetric[]> {
  const compose = await fileMetric(composeFile);
  const swarm = await fileMetric(swarmFile);
  const k8s = await fileMetric(k8sFile);

  return [
    { target: "Docker Compose", files: 1, ...compose },
    { target: "Docker Swarm", files: 1, ...swarm },
    { target: "Kubernetes", files: 1, ...k8s }
  ];
}

async function fileMetric(
  path: string
): Promise<{ bytes: number; lines: number; resources: number }> {
  const content = await readFile(path, "utf8");
  const lines = content
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"));
  // Resource count: Compose/Swarm services, Kubernetes documents.
  const resources =
    path.endsWith(".yaml") && content.includes("kind:")
      ? content.split("\n").filter((line) => line.trim().startsWith("kind:")).length
      : content.split("\n").filter((line) => /^ {2}[a-z0-9-]+:$/.test(line)).length;

  return { bytes: Buffer.byteLength(content, "utf8"), lines: lines.length, resources };
}

// --- outputs ------------------------------------------------------------------

async function writeCsv(
  runtimes: TargetRuntime[],
  config: ConfigMetric[]
): Promise<void> {
  const configByTarget = new Map(config.map((c) => [c.target, c]));
  const header = [
    "target",
    "startup_seconds",
    "avg_cpu_percent",
    "max_memory_bytes",
    "config_bytes",
    "config_lines",
    "config_resources",
    "scaling_scenarios",
    "scaling_succeeded",
    "recovery_scenarios",
    "recovery_measured",
    "mean_recovery_seconds"
  ].join(",");

  const rows = runtimes.map((rt) => {
    const cfg = configByTarget.get(rt.target);
    const recoverySeconds = rt.recovery
      .map((r) => r.seconds)
      .filter((s): s is number => s !== null);
    return [
      rt.target,
      rt.startupSeconds === null ? "" : round(rt.startupSeconds, 1),
      round(rt.avgCpuPercent, 2),
      Math.round(rt.maxMemoryBytes),
      cfg?.bytes ?? "",
      cfg?.lines ?? "",
      cfg?.resources ?? "",
      rt.scaling.length,
      rt.scaling.filter((s) => s.seconds !== null).length,
      rt.recovery.length,
      recoverySeconds.length,
      recoverySeconds.length > 0 ? round(mean(recoverySeconds), 1) : ""
    ].join(",");
  });

  // Kubernetes appears in the config comparison only (not run here).
  const k8s = configByTarget.get("Kubernetes");
  if (k8s) {
    rows.push(
      [
        "Kubernetes (not run)",
        "",
        "",
        "",
        k8s.bytes,
        k8s.lines,
        k8s.resources,
        "",
        "",
        "",
        "",
        ""
      ].join(",")
    );
  }

  await writeFile(
    resolve(processedDir, "orchestration-comparison.csv"),
    `${[header, ...rows].join("\n")}\n`
  );
}

async function writeCharts(
  runtimes: TargetRuntime[],
  config: ConfigMetric[]
): Promise<string[]> {
  const runtimeTargets = runtimes.map((rt) => rt.target.replace("Docker ", ""));

  const charts: Array<{ file: string; svg: string }> = [
    {
      file: "orchestration-startup.svg",
      svg: renderBarChart({
        title: "Stack Startup Time by Orchestrator",
        subtitle: "Time until all core services are healthy/converged, lower is better",
        categories: runtimeTargets,
        yAxisLabel: "seconds",
        format: (value) => value.toFixed(1),
        series: [
          {
            name: "Startup (s)",
            color: "#4e79a7",
            values: runtimes.map((rt) => rt.startupSeconds ?? 0)
          }
        ]
      })
    },
    {
      file: "orchestration-recovery.svg",
      svg: renderBarChart({
        title: "Failure Recovery Time by Orchestrator",
        subtitle: "Seconds to reschedule a killed instance (Compose has no reconciler)",
        categories: runtimeTargets,
        yAxisLabel: "seconds",
        format: (value) => value.toFixed(1),
        series: [
          {
            name: "Mean recovery (s)",
            color: "#e15759",
            values: runtimes.map((rt) => {
              const measured = rt.recovery
                .map((r) => r.seconds)
                .filter((s): s is number => s !== null);
              return measured.length > 0 ? mean(measured) : 0;
            })
          }
        ]
      })
    },
    {
      file: "orchestration-config-size.svg",
      svg: renderBarChart({
        title: "Configuration Size by Orchestrator",
        subtitle: "Non-comment lines of deployment configuration",
        categories: config.map((c) => c.target.replace("Docker ", "")),
        yAxisLabel: "config lines",
        format: (value) => value.toFixed(0),
        series: [
          {
            name: "Config lines",
            color: "#59a14f",
            values: config.map((c) => c.lines)
          }
        ]
      })
    }
  ];

  for (const chart of charts) {
    await writeFile(resolve(chartsDir, chart.file), chart.svg);
  }

  return charts.map((chart) => chart.file);
}

async function writeReport(
  runtimes: TargetRuntime[],
  config: ConfigMetric[],
  charts: string[]
): Promise<void> {
  const configByTarget = new Map(config.map((c) => [c.target, c]));
  const lines: string[] = [];

  lines.push("# Orchestration Comparison — Compose vs Swarm vs Kubernetes");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push(
    "This compares three deployment targets for the same core stack (4 services + " +
      "PostgreSQL, Redis, RabbitMQ). Docker Compose and Docker Swarm were deployed and " +
      "measured live; the Kubernetes manifests are authored and statically validated " +
      "(`kubeconform`) but not run here because no local cluster is present. Startup, " +
      "scaling, and recovery numbers are from real deployments."
  );
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(
    "| Target | Startup (s) | Config lines | Config bytes | Avg CPU % | Max memory (MiB) |"
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const rt of runtimes) {
    const cfg = configByTarget.get(rt.target);
    lines.push(
      `| ${rt.target} | ${rt.startupSeconds === null ? "n/a" : rt.startupSeconds.toFixed(1)} | ` +
        `${cfg?.lines ?? "—"} | ${cfg?.bytes ?? "—"} | ${rt.avgCpuPercent.toFixed(1)} | ` +
        `${(rt.maxMemoryBytes / 1024 ** 2).toFixed(1)} |`
    );
  }
  const k8s = configByTarget.get("Kubernetes");
  if (k8s) {
    lines.push(
      `| Kubernetes (not run) | n/a | ${k8s.lines} | ${k8s.bytes} | n/a | n/a |`
    );
  }
  lines.push("");

  lines.push("## Scaling");
  lines.push("");
  lines.push("| Target | Service | Change | Time (s) | Behaviour |");
  lines.push("| --- | --- | --- | ---: | --- |");
  for (const rt of runtimes) {
    for (const event of rt.scaling) {
      lines.push(
        `| ${rt.target} | ${event.service} | ${event.from}→${event.to} | ` +
          `${event.seconds === null ? "n/a" : event.seconds.toFixed(1)} | ${event.note} |`
      );
    }
  }
  lines.push(
    "| Kubernetes (not run) | transaction-service | 2→5 | n/a | `HorizontalPodAutoscaler` (CPU 70%) in the manifest |"
  );
  lines.push("");

  lines.push("## Failure Recovery");
  lines.push("");
  lines.push("| Target | Service | Recovery (s) | Behaviour |");
  lines.push("| --- | --- | ---: | --- |");
  for (const rt of runtimes) {
    for (const event of rt.recovery) {
      lines.push(
        `| ${rt.target} | ${event.service} | ${event.seconds === null ? "n/a" : event.seconds.toFixed(1)} | ${event.note} |`
      );
    }
  }
  lines.push(
    "| Kubernetes (not run) | any | n/a | ReplicaSet controller reschedules killed pods |"
  );
  lines.push("");

  lines.push("## Charts");
  lines.push("");
  for (const chart of charts) {
    lines.push(`![${chart}](../results/charts/${chart})`);
    lines.push("");
  }

  lines.push("## Operational Trade-offs");
  lines.push("");
  lines.push(
    "- **Docker Compose** — simplest config and the lowest barrier for local " +
      "reproducibility, but it is not a reconciler: a killed container is not restarted, " +
      "and host-port publishing prevents scaling a service beyond one replica without " +
      "editing the file."
  );
  lines.push(
    "- **Docker Swarm** — adds a `deploy` block per service for replicas, restart " +
      "policy, and resource limits. The routing mesh load-balances a single published " +
      "port across replicas, and the orchestrator automatically reschedules killed tasks. " +
      "Modest extra configuration over Compose; no startup ordering (`depends_on` is " +
      "ignored), so services restart until dependencies are reachable."
  );
  lines.push(
    "- **Kubernetes** — the most configuration (Namespace, ConfigMap, Secret, PVC, " +
      "Deployments, Services, HPA) and operational concepts, in exchange for the " +
      "strongest scaling and self-healing primitives. Treated as optional challenge mode."
  );
  lines.push("");

  lines.push("## Threats to Validity");
  lines.push("");
  lines.push(
    "- Single-node, single-run measurements on one machine; startup and recovery times " +
      "depend on hardware, image cache, and Docker Desktop overhead."
  );
  lines.push(
    "- Swarm has no `depends_on` ordering, so its startup includes app-service restart " +
      "loops until the datastores accept connections — a real but variable cost."
  );
  lines.push(
    "- Kubernetes was statically validated only; its runtime numbers are not measured " +
      "and are intentionally left as `n/a`."
  );
  lines.push("");

  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("# Requires Docker; builds are reused from the Compose images.");
  lines.push("pnpm orchestration:run");
  lines.push("```");
  lines.push("");

  await writeFile(reportPath, lines.join("\n"));
}

// --- low-level utilities ------------------------------------------------------

function run(
  args: string[],
  options: { allowFail?: boolean; timeoutMs?: number; stream?: boolean } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const [command, ...rest] = args;
    const child = spawn(command, rest, { cwd: workspaceRoot });
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
        rejectPromise(new Error(`${args.join(" ")} exited ${code}: ${result.stderr}`));
      }
    });
  });
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
  intervalMs = 2000
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

function parsePercent(value: string): number {
  return Number(value.replace("%", "")) || 0;
}

function parseMemoryBytes(value: string): number {
  const amount = value.split("/")[0]?.trim() ?? "0B";
  const match = /^([\d.]+)\s*([KMGT]?i?B|B)$/.exec(amount);
  if (!match) {
    return 0;
  }
  const size = Number(match[1]);
  const multipliers: Record<string, number> = {
    B: 1,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3
  };
  return size * (multipliers[match[2]] ?? 1);
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

void main();
