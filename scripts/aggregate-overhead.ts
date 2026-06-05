import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderBarChart } from "./lib/svg-chart";

// Phase 8 — Observability Overhead Experiments.
//
// This script does NOT run experiments. It aggregates the per-mode results that
// phases 3-7 already produced (the processed CSVs and the raw Loki/Jaeger volume
// summaries) into a single cross-mode comparison: a combined CSV + JSON, a set of
// SVG charts, and docs/observability-overhead-report.md.
//
// It is intentionally dependency-free and deterministic so it can be re-run any
// time the underlying experiments are refreshed.

type ModeDefinition = {
  id: string;
  label: string;
  shortLabel: string;
  obsMode: string;
  csv: string;
  rawPrefix: string;
  hasLogs: boolean;
  hasTraces: boolean;
  hasCollector: boolean;
};

type RunRow = Record<string, string>;

type LogVolume = {
  totalEntries: number;
  entriesPerTenThousandRequests: number;
  averageEntryBytes: number;
  estimatedStorageBytes: number;
};

type TraceVolume = {
  totalTraces: number;
  totalSpans: number;
  tracesPerTenThousandRequests: number;
  spansPerTenThousandRequests: number;
  completeMainFlowTraceRate: number;
};

type ModeAggregate = {
  mode: ModeDefinition;
  runs: number;
  meanRequestsPerRun: number;
  meanErrorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  p95StdMs: number;
  p95VariancePercent: number;
  meanCpuPercent: number;
  maxMemoryBytes: number;
  collectorCpuPercent: number;
  collectorMaxMemoryBytes: number;
  logVolume?: LogVolume;
  traceVolume?: TraceVolume;
};

type ModeWithOverhead = ModeAggregate & {
  p50OverheadPercent: number;
  p95OverheadPercent: number;
  p99OverheadPercent: number;
  cpuOverheadPercent: number;
  memoryOverheadPercent: number;
};

const MODES: ModeDefinition[] = [
  {
    id: "baseline",
    label: "Baseline (none)",
    shortLabel: "Baseline",
    obsMode: "none",
    csv: "baseline-summary.csv",
    rawPrefix: "baseline",
    hasLogs: false,
    hasTraces: false,
    hasCollector: false
  },
  {
    id: "metrics-only",
    label: "Metrics Only",
    shortLabel: "Metrics",
    obsMode: "metrics",
    csv: "metrics-only-summary.csv",
    rawPrefix: "metrics-only",
    hasLogs: false,
    hasTraces: false,
    hasCollector: false
  },
  {
    id: "metrics-logs",
    label: "Metrics + Logs",
    shortLabel: "M+L",
    obsMode: "metrics_logs",
    csv: "metrics-logs-summary.csv",
    rawPrefix: "metrics-logs",
    hasLogs: true,
    hasTraces: false,
    hasCollector: false
  },
  {
    id: "metrics-logs-traces",
    label: "Metrics + Logs + Traces",
    shortLabel: "M+L+T",
    obsMode: "metrics_logs_traces",
    csv: "metrics-logs-traces-summary.csv",
    rawPrefix: "metrics-logs-traces",
    hasLogs: true,
    hasTraces: true,
    hasCollector: false
  },
  {
    id: "otel-full",
    label: "Full OpenTelemetry Pipeline",
    shortLabel: "OTel Full",
    obsMode: "otel_full",
    csv: "otel-full-summary.csv",
    rawPrefix: "otel-full",
    hasLogs: true,
    hasTraces: true,
    hasCollector: true
  }
];

const workspaceRoot = process.cwd();
const processedDir = resolve(workspaceRoot, "results", "processed");
const rawDir = resolve(workspaceRoot, "results", "raw");
const chartsDir = resolve(workspaceRoot, "results", "charts");
const reportPath = resolve(workspaceRoot, "docs", "observability-overhead-report.md");

const COLORS = {
  p50: "#4e79a7",
  p95: "#f28e2b",
  p99: "#e15759",
  cpu: "#59a14f",
  memory: "#76b7b2",
  log: "#af7aa1",
  trace: "#edc948",
  costUp: "#e15759",
  costDown: "#59a14f"
};

async function main(): Promise<void> {
  await mkdir(chartsDir, { recursive: true });

  const aggregates: ModeAggregate[] = [];

  for (const mode of MODES) {
    const rows = await readModeRows(mode);
    aggregates.push(await aggregateMode(mode, rows));
  }

  const baseline = aggregates[0];
  const withOverhead: ModeWithOverhead[] = aggregates.map((aggregate) => ({
    ...aggregate,
    p50OverheadPercent: percentageChange(aggregate.p50Ms, baseline.p50Ms),
    p95OverheadPercent: percentageChange(aggregate.p95Ms, baseline.p95Ms),
    p99OverheadPercent: percentageChange(aggregate.p99Ms, baseline.p99Ms),
    cpuOverheadPercent: percentageChange(
      aggregate.meanCpuPercent,
      baseline.meanCpuPercent
    ),
    memoryOverheadPercent: percentageChange(
      aggregate.maxMemoryBytes,
      baseline.maxMemoryBytes
    )
  }));

  const totalRuns = withOverhead.reduce((total, mode) => total + mode.runs, 0);

  await writeCombinedCsv(withOverhead);
  await writeCombinedJson(withOverhead, totalRuns);
  const charts = await writeCharts(withOverhead);
  await writeReport(withOverhead, totalRuns, charts);

  console.log(
    `Aggregated ${withOverhead.length} observability modes (${totalRuns} runs).`
  );
  console.log(`Combined CSV: ${resolve(processedDir, "observability-overhead.csv")}`);
  console.log(`Combined JSON: ${resolve(processedDir, "observability-overhead.json")}`);
  console.log(`Charts: ${chartsDir} (${charts.length} files)`);
  console.log(`Report: ${reportPath}`);
}

async function readModeRows(mode: ModeDefinition): Promise<RunRow[]> {
  const path = resolve(processedDir, mode.csv);
  let content: string;

  try {
    content = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `Missing processed results for mode "${mode.id}". Expected ${path}. ` +
        `Run the phase that produces it before aggregating.`
    );
  }

  const rows = parseCsv(content);

  if (rows.length < 3) {
    throw new Error(
      `Mode "${mode.id}" has only ${rows.length} run(s); Phase 8 requires at least 3.`
    );
  }

  return rows;
}

async function aggregateMode(
  mode: ModeDefinition,
  rows: RunRow[]
): Promise<ModeAggregate> {
  const p95Values = rows.map((row) => num(row, "duration_p95_ms"));
  const p95Mean = mean(p95Values);
  const p95Std = standardDeviation(p95Values);

  return {
    mode,
    runs: rows.length,
    meanRequestsPerRun: mean(rows.map((row) => num(row, "http_requests"))),
    meanErrorRate: mean(rows.map((row) => num(row, "error_rate"))),
    p50Ms: mean(rows.map((row) => num(row, "duration_p50_ms"))),
    p95Ms: p95Mean,
    p99Ms: mean(rows.map((row) => num(row, "duration_p99_ms"))),
    p95StdMs: p95Std,
    p95VariancePercent: p95Mean === 0 ? 0 : (p95Std / p95Mean) * 100,
    meanCpuPercent: mean(rows.map((row) => num(row, "avg_cpu_percent"))),
    maxMemoryBytes: Math.max(...rows.map((row) => num(row, "max_memory_bytes"))),
    collectorCpuPercent: mode.hasCollector
      ? mean(rows.map((row) => num(row, "collector_avg_cpu_percent")))
      : 0,
    collectorMaxMemoryBytes: mode.hasCollector
      ? Math.max(...rows.map((row) => num(row, "collector_max_memory_bytes")))
      : 0,
    logVolume: mode.hasLogs ? await readLogVolume(mode) : undefined,
    traceVolume: mode.hasTraces ? await readTraceVolume(mode) : undefined
  };
}

async function readLogVolume(mode: ModeDefinition): Promise<LogVolume | undefined> {
  const data = await readLatestRawJson<Partial<LogVolume>>(mode, "loki-log-volume.json");

  if (!data) {
    return undefined;
  }

  return {
    totalEntries: data.totalEntries ?? 0,
    entriesPerTenThousandRequests: data.entriesPerTenThousandRequests ?? 0,
    averageEntryBytes: data.averageEntryBytes ?? 0,
    estimatedStorageBytes: data.estimatedStorageBytes ?? 0
  };
}

async function readTraceVolume(mode: ModeDefinition): Promise<TraceVolume | undefined> {
  const data = await readLatestRawJson<Partial<TraceVolume>>(
    mode,
    "jaeger-trace-volume.json"
  );

  if (!data) {
    return undefined;
  }

  return {
    totalTraces: data.totalTraces ?? 0,
    totalSpans: data.totalSpans ?? 0,
    tracesPerTenThousandRequests: data.tracesPerTenThousandRequests ?? 0,
    spansPerTenThousandRequests: data.spansPerTenThousandRequests ?? 0,
    completeMainFlowTraceRate: data.completeMainFlowTraceRate ?? 0
  };
}

async function readLatestRawJson<T>(
  mode: ModeDefinition,
  fileName: string
): Promise<T | undefined> {
  const directory = await findLatestRawDir(mode);

  if (!directory) {
    return undefined;
  }

  try {
    return JSON.parse(await readFile(resolve(rawDir, directory, fileName), "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function findLatestRawDir(mode: ModeDefinition): Promise<string | undefined> {
  // Raw directories are named `${rawPrefix}-${isoTimestamp}`. The timestamp starts
  // with a 4-digit year, which lets us match "metrics-logs-2026-..." without also
  // matching the longer "metrics-logs-traces-2026-..." prefix.
  const pattern = new RegExp(`^${escapeRegExp(mode.rawPrefix)}-\\d{4}-`);
  const entries = await readdir(rawDir, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  return matches.at(-1);
}

async function writeCombinedCsv(modes: ModeWithOverhead[]): Promise<void> {
  const header = [
    "mode",
    "obs_mode",
    "runs",
    "mean_requests_per_run",
    "mean_error_rate",
    "p50_ms",
    "p95_ms",
    "p99_ms",
    "p95_variance_percent",
    "mean_cpu_percent",
    "max_memory_bytes",
    "collector_cpu_percent",
    "collector_max_memory_bytes",
    "p50_overhead_percent",
    "p95_overhead_percent",
    "p99_overhead_percent",
    "cpu_overhead_percent",
    "memory_overhead_percent",
    "log_entries_per_10k",
    "log_storage_bytes",
    "traces_per_10k",
    "spans_per_10k",
    "complete_main_flow_trace_rate"
  ].join(",");

  const rows = modes.map((mode) =>
    [
      mode.mode.id,
      mode.mode.obsMode,
      mode.runs,
      round(mode.meanRequestsPerRun, 2),
      round(mode.meanErrorRate, 4),
      round(mode.p50Ms, 3),
      round(mode.p95Ms, 3),
      round(mode.p99Ms, 3),
      round(mode.p95VariancePercent, 2),
      round(mode.meanCpuPercent, 3),
      round(mode.maxMemoryBytes, 0),
      round(mode.collectorCpuPercent, 3),
      round(mode.collectorMaxMemoryBytes, 0),
      round(mode.p50OverheadPercent, 2),
      round(mode.p95OverheadPercent, 2),
      round(mode.p99OverheadPercent, 2),
      round(mode.cpuOverheadPercent, 2),
      round(mode.memoryOverheadPercent, 2),
      round(mode.logVolume?.entriesPerTenThousandRequests ?? 0, 2),
      round(mode.logVolume?.estimatedStorageBytes ?? 0, 0),
      round(mode.traceVolume?.tracesPerTenThousandRequests ?? 0, 2),
      round(mode.traceVolume?.spansPerTenThousandRequests ?? 0, 2),
      round(mode.traceVolume?.completeMainFlowTraceRate ?? 0, 4)
    ].join(",")
  );

  await writeFile(
    resolve(processedDir, "observability-overhead.csv"),
    `${[header, ...rows].join("\n")}\n`
  );
}

async function writeCombinedJson(
  modes: ModeWithOverhead[],
  totalRuns: number
): Promise<void> {
  const payload = {
    generatedAt: new Date().toISOString(),
    totalRuns,
    modeCount: modes.length,
    baselineMode: modes[0].mode.id,
    modes: modes.map((mode) => ({
      id: mode.mode.id,
      label: mode.mode.label,
      obsMode: mode.mode.obsMode,
      runs: mode.runs,
      latencyMs: { p50: mode.p50Ms, p95: mode.p95Ms, p99: mode.p99Ms },
      p95VariancePercent: mode.p95VariancePercent,
      meanRequestsPerRun: mode.meanRequestsPerRun,
      meanErrorRate: mode.meanErrorRate,
      resources: {
        meanCpuPercent: mode.meanCpuPercent,
        maxMemoryBytes: mode.maxMemoryBytes,
        collectorCpuPercent: mode.collectorCpuPercent,
        collectorMaxMemoryBytes: mode.collectorMaxMemoryBytes
      },
      overheadVsBaselinePercent: {
        p50: mode.p50OverheadPercent,
        p95: mode.p95OverheadPercent,
        p99: mode.p99OverheadPercent,
        cpu: mode.cpuOverheadPercent,
        memory: mode.memoryOverheadPercent
      },
      logVolume: mode.logVolume ?? null,
      traceVolume: mode.traceVolume ?? null
    }))
  };

  await writeFile(
    resolve(processedDir, "observability-overhead.json"),
    `${JSON.stringify(payload, null, 2)}\n`
  );
}

async function writeCharts(modes: ModeWithOverhead[]): Promise<string[]> {
  const labels = modes.map((mode) => mode.mode.shortLabel);
  const logModes = modes.filter((mode) => mode.logVolume);
  const traceModes = modes.filter((mode) => mode.traceVolume);

  const charts: Array<{ file: string; svg: string }> = [
    {
      file: "latency-comparison.svg",
      svg: renderBarChart({
        title: "Latency by Observability Mode",
        subtitle: "Mean of 3 runs per mode, lower is better",
        categories: labels,
        yAxisLabel: "milliseconds",
        format: (value) => `${value.toFixed(1)}`,
        series: [
          { name: "p50", color: COLORS.p50, values: modes.map((m) => m.p50Ms) },
          { name: "p95", color: COLORS.p95, values: modes.map((m) => m.p95Ms) },
          { name: "p99", color: COLORS.p99, values: modes.map((m) => m.p99Ms) }
        ]
      })
    },
    {
      file: "cpu-comparison.svg",
      svg: renderBarChart({
        title: "Mean Docker CPU by Observability Mode",
        subtitle: "Average sampled container CPU across the run",
        categories: labels,
        yAxisLabel: "CPU %",
        format: (value) => `${value.toFixed(1)}`,
        series: [
          { name: "CPU %", color: COLORS.cpu, values: modes.map((m) => m.meanCpuPercent) }
        ]
      })
    },
    {
      file: "memory-comparison.svg",
      svg: renderBarChart({
        title: "Max Memory by Observability Mode",
        subtitle: "Peak sampled container memory",
        categories: labels,
        yAxisLabel: "MiB",
        format: (value) => `${value.toFixed(0)}`,
        series: [
          {
            name: "Max memory (MiB)",
            color: COLORS.memory,
            values: modes.map((m) => m.maxMemoryBytes / 1024 ** 2)
          }
        ]
      })
    },
    {
      file: "p95-overhead.svg",
      svg: renderBarChart({
        title: "p95 Latency Overhead vs Baseline",
        subtitle: "((mode - baseline) / baseline) * 100; negative = faster than baseline",
        categories: labels,
        yAxisLabel: "overhead %",
        format: (value) => `${value.toFixed(0)}%`,
        series: [
          {
            name: "p95 overhead %",
            color: COLORS.costUp,
            values: modes.map((m) => m.p95OverheadPercent),
            colors: modes.map((m) =>
              m.p95OverheadPercent >= 0 ? COLORS.costUp : COLORS.costDown
            )
          }
        ]
      })
    },
    {
      file: "log-volume.svg",
      svg: renderBarChart({
        title: "Log Volume by Observability Mode",
        subtitle: "Loki entries per 10,000 requests",
        categories: logModes.map((mode) => mode.mode.shortLabel),
        yAxisLabel: "entries / 10k req",
        format: (value) => `${value.toFixed(0)}`,
        series: [
          {
            name: "Log entries / 10k req",
            color: COLORS.log,
            values: logModes.map((m) => m.logVolume?.entriesPerTenThousandRequests ?? 0)
          }
        ]
      })
    },
    {
      file: "trace-volume.svg",
      svg: renderBarChart({
        title: "Trace Volume by Observability Mode",
        subtitle: "Jaeger spans per 10,000 requests",
        categories: traceModes.map((mode) => mode.mode.shortLabel),
        yAxisLabel: "spans / 10k req",
        format: (value) => `${value.toFixed(0)}`,
        series: [
          {
            name: "Spans / 10k req",
            color: COLORS.trace,
            values: traceModes.map((m) => m.traceVolume?.spansPerTenThousandRequests ?? 0)
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
  modes: ModeWithOverhead[],
  totalRuns: number,
  charts: string[]
): Promise<void> {
  const baseline = modes[0];
  const lines: string[] = [];

  lines.push("# Observability Overhead Report");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push(
    "This report compares the five observability modes (E0-E4) defined in the " +
      "experiment matrix. Each mode was executed with the same k6 baseline scenario " +
      "and the same Docker resources; only the observability instrumentation changed. " +
      "All values are aggregated from the per-mode results stored under `results/`."
  );
  lines.push("");
  lines.push(`- Observability modes compared: ${modes.length}`);
  lines.push(`- Total experiment runs: ${totalRuns}`);
  lines.push(`- Runs per mode: ${modes.map((mode) => mode.runs).join(", ")}`);
  lines.push("- Overhead formula: `((observed - baseline) / baseline) * 100`");
  lines.push(
    `- Baseline mode: \`${baseline.mode.label}\` (OBS_MODE=${baseline.mode.obsMode})`
  );
  lines.push("");

  lines.push("## Experiment Summary");
  lines.push("");
  lines.push(
    "| Mode | OBS_MODE | Runs | Req/run | Error rate | p50 ms | p95 ms | p99 ms | p95 var % | CPU % | Max mem (MiB) |"
  );
  lines.push(
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
  );
  for (const mode of modes) {
    lines.push(
      `| ${mode.mode.label} | ${mode.mode.obsMode} | ${mode.runs} | ` +
        `${mode.meanRequestsPerRun.toFixed(0)} | ${mode.meanErrorRate.toFixed(4)} | ` +
        `${mode.p50Ms.toFixed(2)} | ${mode.p95Ms.toFixed(2)} | ${mode.p99Ms.toFixed(2)} | ` +
        `${mode.p95VariancePercent.toFixed(1)} | ${mode.meanCpuPercent.toFixed(2)} | ` +
        `${(mode.maxMemoryBytes / 1024 ** 2).toFixed(1)} |`
    );
  }
  lines.push("");

  lines.push("## Overhead vs Baseline");
  lines.push("");
  lines.push(
    "| Mode | p50 overhead | p95 overhead | p99 overhead | CPU overhead | Memory overhead |"
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const mode of modes) {
    lines.push(
      `| ${mode.mode.label} | ${signed(mode.p50OverheadPercent)} | ` +
        `${signed(mode.p95OverheadPercent)} | ${signed(mode.p99OverheadPercent)} | ` +
        `${signed(mode.cpuOverheadPercent)} | ${signed(mode.memoryOverheadPercent)} |`
    );
  }
  lines.push("");

  const collectorMode = modes.find((mode) => mode.mode.hasCollector);
  if (collectorMode) {
    lines.push("## OpenTelemetry Collector Cost");
    lines.push("");
    lines.push(`- Mean Collector CPU: ${collectorMode.collectorCpuPercent.toFixed(2)}%`);
    lines.push(
      `- Max Collector memory: ${(collectorMode.collectorMaxMemoryBytes / 1024 ** 2).toFixed(1)} MiB`
    );
    lines.push(
      "- In `otel_full` mode services export through the Collector instead of " +
        "writing to each backend directly, which moves part of the telemetry cost " +
        "out of the service processes and into the Collector container."
    );
    lines.push("");
  }

  const logModes = modes.filter((mode) => mode.logVolume);
  if (logModes.length > 0) {
    lines.push("## Telemetry Volume");
    lines.push("");
    lines.push(
      "| Mode | Log entries / 10k req | Est. log storage (MiB) | Traces / 10k req | Spans / 10k req | Complete main-flow trace rate |"
    );
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const mode of logModes) {
      lines.push(
        `| ${mode.mode.label} | ` +
          `${(mode.logVolume?.entriesPerTenThousandRequests ?? 0).toFixed(0)} | ` +
          `${((mode.logVolume?.estimatedStorageBytes ?? 0) / 1024 ** 2).toFixed(2)} | ` +
          `${(mode.traceVolume?.tracesPerTenThousandRequests ?? 0).toFixed(0)} | ` +
          `${(mode.traceVolume?.spansPerTenThousandRequests ?? 0).toFixed(0)} | ` +
          `${((mode.traceVolume?.completeMainFlowTraceRate ?? 0) * 100).toFixed(1)}% |`
      );
    }
    lines.push("");
  }

  lines.push("## Charts");
  lines.push("");
  for (const chart of charts) {
    lines.push(`![${chart}](../results/charts/${chart})`);
    lines.push("");
  }

  lines.push("## Analysis");
  lines.push("");
  for (const mode of modes.slice(1)) {
    lines.push(`- **${mode.mode.label}**: ${describeOverhead(mode)}`);
  }
  lines.push("");

  lines.push("## Threats to Validity");
  lines.push("");
  lines.push(
    "- Load profile is the short baseline scenario (few VUs, ~8s per run); absolute " +
      "latencies are small, so a single slow run can dominate a mode's mean. The " +
      "`p95 var %` column quantifies this run-to-run spread."
  );
  lines.push(
    "- All runs share one machine and Docker resource envelope, but were captured at " +
      "different times; background load on the host can shift CPU and memory readings."
  );
  lines.push(
    "- Memory is the peak sampled container memory, not steady-state; at this load it " +
      "is dominated by runtime/heap baselines rather than telemetry buffers."
  );
  lines.push(
    "- Overhead percentages are most meaningful for the heavier modes (logs, traces, " +
      "full pipeline). Near-baseline modes can show small negative overhead purely " +
      "from noise; this is expected and is not evidence that instrumentation is free."
  );
  lines.push("");

  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("pnpm overhead:report");
  lines.push("```");
  lines.push("");
  lines.push(
    "Re-run the per-mode experiments (`pnpm baseline:run`, `pnpm metrics:run`, ...) " +
      "first to refresh the inputs, then re-run the aggregation above."
  );
  lines.push("");

  await writeFile(reportPath, lines.join("\n"));
}

function describeOverhead(mode: ModeWithOverhead): string {
  const p95 = mode.p95OverheadPercent;
  const cpu = mode.cpuOverheadPercent;
  const latencyPhrase =
    p95 >= 25
      ? `increased mean p95 latency by ${p95.toFixed(0)}%`
      : p95 <= -25
        ? `recorded ${Math.abs(p95).toFixed(0)}% lower mean p95 latency than baseline (within run-to-run noise at this load)`
        : `kept mean p95 latency within run-to-run noise of baseline (${signed(p95)})`;
  const cpuPhrase =
    cpu >= 15
      ? `CPU rose ${cpu.toFixed(0)}%`
      : cpu <= -15
        ? `CPU was ${Math.abs(cpu).toFixed(0)}% lower (noise)`
        : `CPU was roughly flat (${signed(cpu)})`;

  const extras: string[] = [];
  if (mode.logVolume) {
    extras.push(
      `~${mode.logVolume.entriesPerTenThousandRequests.toFixed(0)} log entries / 10k req`
    );
  }
  if (mode.traceVolume) {
    extras.push(
      `~${mode.traceVolume.spansPerTenThousandRequests.toFixed(0)} spans / 10k req`
    );
  }
  if (mode.mode.hasCollector) {
    extras.push(`Collector adds ${mode.collectorCpuPercent.toFixed(0)}% CPU`);
  }

  const extraText = extras.length > 0 ? ` Telemetry cost: ${extras.join("; ")}.` : "";
  return `${latencyPhrase}; ${cpuPhrase}.${extraText}`;
}

// --- helpers ------------------------------------------------------------------

function parseCsv(content: string): RunRow[] {
  const [headerLine, ...lines] = content.trim().split("\n");
  const headers = headerLine.split(",");

  return lines
    .filter(Boolean)
    .map((line) =>
      Object.fromEntries(line.split(",").map((value, index) => [headers[index], value]))
    );
}

function num(row: RunRow, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function percentageChange(current: number, baseline: number): number {
  if (baseline === 0) {
    return 0;
  }

  return ((current - baseline) / baseline) * 100;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const avg = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - avg) ** 2, 0) / (values.length - 1);

  return Math.sqrt(variance);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

void main();
