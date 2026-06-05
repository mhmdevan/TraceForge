import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type K6Metric = {
  [key: string]: unknown;
  values?: Record<string, number>;
};

type K6Summary = {
  metrics?: Record<string, K6Metric>;
};

type DockerStatsSample = {
  sampledAt: string;
  containers: DockerContainerStats[];
};

type DockerContainerStats = {
  name: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryRaw: string;
};

type RunResult = {
  run: number;
  status: "passed" | "failed";
  k6Mode: "local" | "docker";
  rawSummaryPath: string;
  rawDockerStatsPath: string;
  httpRequests: number;
  errorRate: number;
  checkRate: number;
  durationAvgMs: number;
  durationP50Ms: number;
  durationP95Ms: number;
  durationP99Ms: number;
  avgCpuPercent: number;
  maxMemoryBytes: number;
  collectorAvgCpuPercent: number;
  collectorMaxMemoryBytes: number;
};

type SummaryStats = {
  meanP95Ms: number;
  meanCpuPercent: number;
  maxMemoryBytes: number;
};

type LogVolumeSummary = {
  totalEntries: number;
  entriesByService: Record<string, number>;
  measurementWindowSeconds: number;
  entriesPerTenThousandRequests: number;
  averageEntryBytes: number;
  estimatedStorageBytes: number;
  rawLogVolumePath: string;
};

type TraceVolumeSummary = {
  totalTraces: number;
  totalSpans: number;
  mainFlowTraceCount: number;
  completeTraceCount: number;
  completeTraceRate: number;
  completeMainFlowTraceRate: number;
  spansByService: Record<string, number>;
  measurementWindowSeconds: number;
  tracesPerTenThousandRequests: number;
  spansPerTenThousandRequests: number;
  exampleTraceId?: string;
  rawTraceVolumePath: string;
  rawTraceSamplePath: string;
};

const workspaceRoot = process.cwd();
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const experimentId = process.env.EXPERIMENT_ID ?? "baseline";
const reportTitle = process.env.EXPERIMENT_TITLE ?? titleFromExperimentId(experimentId);
const observabilityMode = process.env.OBS_MODE ?? "none";
const smokeCommand = process.env.EXPERIMENT_SMOKE_COMMAND ?? "smoke:baseline";
const baselineCsvPath = process.env.EXPERIMENT_BASELINE_CSV
  ? resolve(workspaceRoot, process.env.EXPERIMENT_BASELINE_CSV)
  : undefined;
const comparisonLabel = process.env.EXPERIMENT_BASELINE_LABEL ?? "Baseline";
const lokiUrl = process.env.EXPERIMENT_LOKI_URL ?? "http://localhost:3100";
const jaegerUrl = process.env.EXPERIMENT_JAEGER_URL ?? "http://localhost:16686";
const localBaseUrl = process.env.EXPERIMENT_BASE_URL ?? "http://localhost:3000";
const dockerBaseUrl = process.env.EXPERIMENT_DOCKER_BASE_URL ?? "http://api-gateway:3000";
const runCount = Number(process.env.EXPERIMENT_RUNS ?? process.env.BASELINE_RUNS ?? 3);
const vus = process.env.EXPERIMENT_VUS ?? process.env.BASELINE_VUS ?? "4";
const duration = process.env.EXPERIMENT_DURATION ?? process.env.BASELINE_DURATION ?? "8s";
const rawDir = resolve(workspaceRoot, "results", "raw", `${experimentId}-${timestamp}`);
const processedDir = resolve(workspaceRoot, "results", "processed");
const reportsDir = resolve(workspaceRoot, "results", "reports");
const processedCsvName = `${experimentId}-summary.csv`;
const reportName = `${experimentId}-summary.md`;
const dockerNetwork =
  process.env.K6_DOCKER_NETWORK ?? "observable-microservice-lab_traceforge";

async function main(): Promise<void> {
  process.env.OBS_MODE = observabilityMode;

  await mkdir(rawDir, { recursive: true });
  await mkdir(processedDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });

  await runSmokeCheck();

  const k6Mode = (await commandExists("k6")) ? "local" : "docker";
  const results: RunResult[] = [];
  const experimentStartedAtMs = Date.now();

  for (let run = 1; run <= runCount; run += 1) {
    results.push(await runBaseline(run, k6Mode));
  }

  const experimentEndedAtMs = Date.now();
  const logVolume = isLogMode(observabilityMode)
    ? await collectLogVolumeSummary(
        experimentStartedAtMs,
        experimentEndedAtMs,
        results.reduce((total, result) => total + result.httpRequests, 0)
      )
    : undefined;
  const traceVolume = isTraceMode(observabilityMode)
    ? await collectTraceVolumeSummary(
        experimentStartedAtMs,
        experimentEndedAtMs,
        results.reduce((total, result) => total + result.httpRequests, 0)
      )
    : undefined;

  await writeProcessedCsv(results);
  await writeReport(results, logVolume, traceVolume);

  console.log(`${experimentId} raw results: ${rawDir}`);
  console.log(
    `${experimentId} processed CSV: ${resolve(processedDir, processedCsvName)}`
  );
  console.log(`${experimentId} report: ${resolve(reportsDir, reportName)}`);
}

async function runSmokeCheck(): Promise<void> {
  await runCommand("pnpm", [smokeCommand], {
    env: {
      ...process.env,
      OBS_MODE: observabilityMode
    }
  });
}

async function runBaseline(run: number, k6Mode: "local" | "docker"): Promise<RunResult> {
  const summaryPath = resolve(rawDir, `k6-summary-run-${run}.json`);
  const dockerStatsPath = resolve(rawDir, `docker-stats-run-${run}.json`);
  const samples: DockerStatsSample[] = [];
  const sampler = startDockerStatsSampler(samples);

  const command =
    k6Mode === "local"
      ? {
          executable: "k6",
          args: [
            "run",
            "--summary-export",
            summaryPath,
            "-e",
            `BASE_URL=${localBaseUrl}`,
            "-e",
            `VUS=${vus}`,
            "-e",
            `DURATION=${duration}`,
            "load-tests/k6/baseline.js"
          ]
        }
      : {
          executable: "docker",
          args: [
            "run",
            "--rm",
            "--network",
            dockerNetwork,
            "-v",
            `${resolve(workspaceRoot, "load-tests", "k6")}:/scripts:ro`,
            "-v",
            `${rawDir}:/results`,
            "grafana/k6:0.54.0",
            "run",
            "--summary-export",
            `/results/k6-summary-run-${run}.json`,
            "-e",
            `BASE_URL=${dockerBaseUrl}`,
            "-e",
            `VUS=${vus}`,
            "-e",
            `DURATION=${duration}`,
            "/scripts/baseline.js"
          ]
        };

  try {
    await runCommand(command.executable, command.args, {
      env: {
        ...process.env,
        OBS_MODE: observabilityMode
      }
    });
  } finally {
    clearInterval(sampler);
    await writeFile(dockerStatsPath, JSON.stringify(samples, null, 2));
  }

  const summary = JSON.parse(await readFile(summaryPath, "utf8")) as K6Summary;
  const aggregate = aggregateDockerStats(samples);

  return {
    run,
    status: "passed",
    k6Mode,
    rawSummaryPath: summaryPath,
    rawDockerStatsPath: dockerStatsPath,
    httpRequests: metric(summary, "http_reqs", "count"),
    errorRate: metric(summary, "http_req_failed", "rate"),
    checkRate: metric(summary, "checks", "rate"),
    durationAvgMs: metric(summary, "http_req_duration", "avg"),
    durationP50Ms: metric(summary, "http_req_duration", "med"),
    durationP95Ms: metric(summary, "http_req_duration", "p(95)"),
    durationP99Ms: metric(summary, "http_req_duration", "p(99)"),
    avgCpuPercent: aggregate.avgCpuPercent,
    maxMemoryBytes: aggregate.maxMemoryBytes,
    collectorAvgCpuPercent: aggregate.collectorAvgCpuPercent,
    collectorMaxMemoryBytes: aggregate.collectorMaxMemoryBytes
  };
}

function startDockerStatsSampler(samples: DockerStatsSample[]): NodeJS.Timeout {
  const sample = async () => {
    try {
      samples.push({
        sampledAt: new Date().toISOString(),
        containers: await collectDockerStats()
      });
    } catch {
      samples.push({
        sampledAt: new Date().toISOString(),
        containers: []
      });
    }
  };

  void sample();

  return setInterval(() => {
    void sample();
  }, 1000);
}

async function collectDockerStats(): Promise<DockerContainerStats[]> {
  const output = await runCommand(
    "docker",
    ["stats", "--no-stream", "--format", "{{json .}}"],
    {
      streamOutput: false
    }
  );

  return output.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, string>)
    .filter((entry) => entry.Name?.startsWith("observable-microservice-lab-"))
    .map((entry) => ({
      name: entry.Name,
      cpuPercent: parsePercent(entry.CPUPerc),
      memoryBytes: parseMemoryBytes(entry.MemUsage),
      memoryRaw: entry.MemUsage
    }));
}

function aggregateDockerStats(samples: DockerStatsSample[]): {
  avgCpuPercent: number;
  maxMemoryBytes: number;
  collectorAvgCpuPercent: number;
  collectorMaxMemoryBytes: number;
} {
  const containers = samples.flatMap((sample) => sample.containers);
  const collectorContainers = containers.filter((container) =>
    container.name.includes("otel-collector")
  );

  if (containers.length === 0) {
    return {
      avgCpuPercent: 0,
      maxMemoryBytes: 0,
      collectorAvgCpuPercent: 0,
      collectorMaxMemoryBytes: 0
    };
  }

  return {
    avgCpuPercent: mean(containers.map((container) => container.cpuPercent)),
    maxMemoryBytes: Math.max(...containers.map((container) => container.memoryBytes)),
    collectorAvgCpuPercent: mean(
      collectorContainers.map((container) => container.cpuPercent)
    ),
    collectorMaxMemoryBytes:
      collectorContainers.length === 0
        ? 0
        : Math.max(...collectorContainers.map((container) => container.memoryBytes))
  };
}

async function writeProcessedCsv(results: RunResult[]): Promise<void> {
  const path = resolve(processedDir, processedCsvName);
  const rows = [
    [
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
      "collector_avg_cpu_percent",
      "collector_max_memory_bytes",
      "raw_summary_path",
      "raw_docker_stats_path"
    ].join(","),
    ...results.map((result) =>
      [
        result.run,
        result.status,
        result.k6Mode,
        result.httpRequests,
        result.errorRate,
        result.checkRate,
        result.durationAvgMs,
        result.durationP50Ms,
        result.durationP95Ms,
        result.durationP99Ms,
        result.avgCpuPercent,
        result.maxMemoryBytes,
        result.collectorAvgCpuPercent,
        result.collectorMaxMemoryBytes,
        result.rawSummaryPath,
        result.rawDockerStatsPath
      ].join(",")
    )
  ];

  await writeFile(path, `${rows.join("\n")}\n`);
}

async function writeReport(
  results: RunResult[],
  logVolume?: LogVolumeSummary,
  traceVolume?: TraceVolumeSummary
): Promise<void> {
  const currentStats = summarizeResults(results);
  const p95Values = results.map((result) => result.durationP95Ms);
  const errorRates = results.map((result) => result.errorRate);
  const p95Mean = currentStats.meanP95Ms;
  const p95Std = standardDeviation(p95Values);
  const p95VariancePercent = p95Mean === 0 ? 0 : (p95Std / p95Mean) * 100;
  const baselineStats = baselineCsvPath
    ? await readSummaryStatsFromCsv(baselineCsvPath)
    : undefined;

  const report = [
    `# ${reportTitle}`,
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Configuration",
    "",
    `- Experiment ID: \`${experimentId}\``,
    `- Observability mode: \`OBS_MODE=${observabilityMode}\``,
    ...telemetryConfigurationLines(observabilityMode),
    `- Runs: ${results.length}`,
    `- VUs: ${vus}`,
    `- Duration per run: ${duration}`,
    ...(baselineCsvPath
      ? [
          `- Comparison label: \`${comparisonLabel}\``,
          `- Comparison CSV: \`${baselineCsvPath}\``
        ]
      : []),
    "",
    "## Summary",
    "",
    `- Successful runs: ${results.filter((result) => result.status === "passed").length}`,
    `- Mean p95 latency: ${p95Mean.toFixed(2)} ms`,
    `- p95 standard deviation: ${p95Std.toFixed(2)} ms`,
    `- p95 run-to-run variance: ${p95VariancePercent.toFixed(2)}%`,
    `- Mean error rate: ${mean(errorRates).toFixed(4)}`,
    `- Mean Docker CPU: ${currentStats.meanCpuPercent.toFixed(2)}%`,
    `- Max observed memory: ${currentStats.maxMemoryBytes.toFixed(0)} bytes`,
    ...(isFullOpenTelemetryMode(observabilityMode)
      ? [
          `- Mean OpenTelemetry Collector CPU: ${mean(
            results.map((result) => result.collectorAvgCpuPercent)
          ).toFixed(2)}%`,
          `- Max OpenTelemetry Collector memory: ${Math.max(
            ...results.map((result) => result.collectorMaxMemoryBytes)
          ).toFixed(0)} bytes`
        ]
      : []),
    ...(logVolume
      ? [
          `- Loki log entries: ${logVolume.totalEntries.toFixed(0)}`,
          `- Log entries per 10,000 requests: ${logVolume.entriesPerTenThousandRequests.toFixed(2)}`,
          `- Estimated log storage: ${logVolume.estimatedStorageBytes.toFixed(0)} bytes`
        ]
      : []),
    ...(traceVolume
      ? [
          `- Jaeger traces: ${traceVolume.totalTraces.toFixed(0)}`,
          `- Jaeger spans: ${traceVolume.totalSpans.toFixed(0)}`,
          `- Complete main-flow trace rate: ${(
            traceVolume.completeMainFlowTraceRate * 100
          ).toFixed(2)}%`,
          `- Spans per 10,000 requests: ${traceVolume.spansPerTenThousandRequests.toFixed(2)}`
        ]
      : []),
    "",
    ...(baselineStats
      ? [
          `## Overhead vs ${comparisonLabel}`,
          "",
          `- p95 latency overhead: ${percentageChange(
            currentStats.meanP95Ms,
            baselineStats.meanP95Ms
          ).toFixed(2)}%`,
          `- Docker CPU overhead: ${percentageChange(
            currentStats.meanCpuPercent,
            baselineStats.meanCpuPercent
          ).toFixed(2)}%`,
          `- Max memory overhead: ${percentageChange(
            currentStats.maxMemoryBytes,
            baselineStats.maxMemoryBytes
          ).toFixed(2)}%`,
          ""
        ]
      : []),
    ...(logVolume
      ? [
          "## Log Volume",
          "",
          `- Measurement window: ${logVolume.measurementWindowSeconds}s`,
          `- Total Loki entries: ${logVolume.totalEntries.toFixed(0)}`,
          `- Average sampled log entry size: ${logVolume.averageEntryBytes.toFixed(2)} bytes`,
          `- Estimated storage bytes: ${logVolume.estimatedStorageBytes.toFixed(0)}`,
          `- Log volume per 10,000 requests: ${logVolume.entriesPerTenThousandRequests.toFixed(2)} entries`,
          `- Raw log volume summary: \`${logVolume.rawLogVolumePath}\``,
          "",
          "| Service | Log entries |",
          "| --- | ---: |",
          ...Object.entries(logVolume.entriesByService).map(
            ([service, entries]) => `| ${service} | ${entries.toFixed(0)} |`
          ),
          ""
        ]
      : []),
    ...(traceVolume
      ? [
          "## Trace Volume",
          "",
          `- Measurement window: ${traceVolume.measurementWindowSeconds}s`,
          `- Total Jaeger traces: ${traceVolume.totalTraces.toFixed(0)}`,
          `- Total Jaeger spans: ${traceVolume.totalSpans.toFixed(0)}`,
          `- Main-flow traces: ${traceVolume.mainFlowTraceCount.toFixed(0)}`,
          `- Complete traces: ${traceVolume.completeTraceCount.toFixed(0)}`,
          `- Complete main-flow trace rate: ${(
            traceVolume.completeMainFlowTraceRate * 100
          ).toFixed(2)}%`,
          `- Complete trace rate across all request types: ${(
            traceVolume.completeTraceRate * 100
          ).toFixed(2)}%`,
          `- Trace volume per 10,000 requests: ${traceVolume.tracesPerTenThousandRequests.toFixed(2)} traces`,
          `- Span volume per 10,000 requests: ${traceVolume.spansPerTenThousandRequests.toFixed(2)} spans`,
          ...(traceVolume.exampleTraceId
            ? [`- Example trace ID: \`${traceVolume.exampleTraceId}\``]
            : []),
          `- Raw trace volume summary: \`${traceVolume.rawTraceVolumePath}\``,
          `- Raw trace sample export: \`${traceVolume.rawTraceSamplePath}\``,
          "",
          "| Service | Spans |",
          "| --- | ---: |",
          ...Object.entries(traceVolume.spansByService).map(
            ([service, spans]) => `| ${service} | ${spans.toFixed(0)} |`
          ),
          ""
        ]
      : []),
    "",
    "## Runs",
    "",
    "| Run | k6 mode | Requests | Error rate | p50 ms | p95 ms | p99 ms | Avg CPU % | Max memory bytes | Collector CPU % | Collector memory bytes |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map(
      (result) =>
        `| ${result.run} | ${result.k6Mode} | ${result.httpRequests} | ${result.errorRate.toFixed(4)} | ${result.durationP50Ms.toFixed(2)} | ${result.durationP95Ms.toFixed(2)} | ${result.durationP99Ms.toFixed(2)} | ${result.avgCpuPercent.toFixed(2)} | ${result.maxMemoryBytes.toFixed(0)} | ${result.collectorAvgCpuPercent.toFixed(2)} | ${result.collectorMaxMemoryBytes.toFixed(0)} |`
    ),
    "",
    "## Raw Result Paths",
    "",
    ...results.flatMap((result) => [
      `- Run ${result.run} k6 summary: \`${result.rawSummaryPath}\``,
      `- Run ${result.run} Docker stats: \`${result.rawDockerStatsPath}\``
    ]),
    ""
  ].join("\n");

  await writeFile(resolve(reportsDir, reportName), report);
}

function metric(summary: K6Summary, metricName: string, valueName: string): number {
  const metricValue = summary.metrics?.[metricName];

  if (!metricValue) {
    return 0;
  }

  const directValue = metricValue[valueName];
  if (typeof directValue === "number") {
    return directValue;
  }

  const nestedValue = metricValue.values?.[valueName];
  if (typeof nestedValue === "number") {
    return nestedValue;
  }

  if (valueName === "rate" && typeof metricValue.value === "number") {
    return metricValue.value;
  }

  return 0;
}

function summarizeResults(results: RunResult[]): SummaryStats {
  return {
    meanP95Ms: mean(results.map((result) => result.durationP95Ms)),
    meanCpuPercent: mean(results.map((result) => result.avgCpuPercent)),
    maxMemoryBytes: Math.max(...results.map((result) => result.maxMemoryBytes))
  };
}

async function readSummaryStatsFromCsv(path: string): Promise<SummaryStats | undefined> {
  try {
    const content = await readFile(path, "utf8");
    const [headerLine, ...lines] = content.trim().split("\n");
    const headers = headerLine.split(",");
    const rows = lines
      .filter(Boolean)
      .map((line) =>
        Object.fromEntries(line.split(",").map((value, index) => [headers[index], value]))
      );

    if (rows.length === 0) {
      return undefined;
    }

    return {
      meanP95Ms: mean(rows.map((row) => Number(row.duration_p95_ms))),
      meanCpuPercent: mean(rows.map((row) => Number(row.avg_cpu_percent))),
      maxMemoryBytes: Math.max(...rows.map((row) => Number(row.max_memory_bytes)))
    };
  } catch {
    return undefined;
  }
}

async function collectLogVolumeSummary(
  startedAtMs: number,
  endedAtMs: number,
  httpRequests: number
): Promise<LogVolumeSummary> {
  await sleep(2000);

  const queryEndedAtMs = Math.max(Date.now(), endedAtMs);
  const measurementWindowSeconds = Math.max(
    1,
    Math.ceil((queryEndedAtMs - startedAtMs) / 1000) + 2
  );
  const range = `${measurementWindowSeconds}s`;
  const totalEntries = await queryLokiNumber(
    `sum(count_over_time({service=~".+"}[${range}]))`,
    queryEndedAtMs
  );
  const entriesByService = await queryLokiSeries(
    `sum by (service) (count_over_time({service=~".+"}[${range}]))`,
    queryEndedAtMs
  );
  const sampleLines = await queryLokiSampleLines(startedAtMs, endedAtMs);
  const averageEntryBytes =
    sampleLines.length === 0
      ? 0
      : mean(sampleLines.map((line) => Buffer.byteLength(line, "utf8")));
  const estimatedStorageBytes = totalEntries * averageEntryBytes;
  const rawLogVolumePath = resolve(rawDir, "loki-log-volume.json");
  const summary: LogVolumeSummary = {
    totalEntries,
    entriesByService,
    measurementWindowSeconds,
    entriesPerTenThousandRequests:
      httpRequests === 0 ? 0 : (totalEntries / httpRequests) * 10_000,
    averageEntryBytes,
    estimatedStorageBytes,
    rawLogVolumePath
  };

  await writeFile(rawLogVolumePath, JSON.stringify(summary, null, 2));

  return summary;
}

async function collectTraceVolumeSummary(
  startedAtMs: number,
  endedAtMs: number,
  httpRequests: number
): Promise<TraceVolumeSummary> {
  await sleep(3000);

  const queryEndedAtMs = Math.max(Date.now(), endedAtMs);
  const traces = await queryJaegerTraces(startedAtMs, queryEndedAtMs);
  const spansByService: Record<string, number> = {};

  for (const trace of traces) {
    for (const span of trace.spans) {
      const serviceName = trace.processes?.[span.processID]?.serviceName ?? "unknown";
      spansByService[serviceName] = (spansByService[serviceName] ?? 0) + 1;
    }
  }

  const completeTraceCount = traces.filter(isCompleteTrace).length;
  const mainFlowTraceCount = traces.filter(isMainFlowTrace).length;
  const totalSpans = traces.reduce((total, trace) => total + trace.spans.length, 0);
  const measurementWindowSeconds = Math.max(
    1,
    Math.ceil((queryEndedAtMs - startedAtMs) / 1000) + 2
  );
  const rawTraceVolumePath = resolve(rawDir, "jaeger-trace-volume.json");
  const rawTraceSamplePath = resolve(rawDir, "jaeger-trace-sample.json");
  const summary: TraceVolumeSummary = {
    totalTraces: traces.length,
    totalSpans,
    mainFlowTraceCount,
    completeTraceCount,
    completeTraceRate: traces.length === 0 ? 0 : completeTraceCount / traces.length,
    completeMainFlowTraceRate:
      mainFlowTraceCount === 0 ? 0 : completeTraceCount / mainFlowTraceCount,
    spansByService,
    measurementWindowSeconds,
    tracesPerTenThousandRequests:
      httpRequests === 0 ? 0 : (traces.length / httpRequests) * 10_000,
    spansPerTenThousandRequests:
      httpRequests === 0 ? 0 : (totalSpans / httpRequests) * 10_000,
    exampleTraceId: traces[0]?.traceID,
    rawTraceVolumePath,
    rawTraceSamplePath
  };

  await writeFile(rawTraceVolumePath, JSON.stringify(summary, null, 2));
  await writeFile(
    rawTraceSamplePath,
    JSON.stringify(
      {
        traces: traces.slice(0, 20)
      },
      null,
      2
    )
  );

  return summary;
}

async function queryJaegerTraces(
  startedAtMs: number,
  endedAtMs: number
): Promise<JaegerTrace[]> {
  const url = new URL(`${jaegerUrl}/api/traces`);
  url.searchParams.set("service", "api-gateway");
  url.searchParams.set("start", `${startedAtMs * 1000}`);
  url.searchParams.set("end", `${endedAtMs * 1000}`);
  url.searchParams.set("limit", "10000");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Jaeger trace query returned ${response.status}`);
  }

  const payload = (await response.json()) as JaegerTraceSearchResponse;
  return payload.data ?? [];
}

function isMainFlowTrace(trace: JaegerTrace): boolean {
  return trace.spans.some((span) => span.operationName === "HTTP POST /transactions");
}

function isCompleteTrace(trace: JaegerTrace): boolean {
  const serviceNames = new Set(
    trace.spans
      .map((span) => trace.processes?.[span.processID]?.serviceName)
      .filter((serviceName): serviceName is string => Boolean(serviceName))
  );
  const operationNames = trace.spans.map((span) => span.operationName);

  return (
    trace.spans.length >= 5 &&
    ["api-gateway", "transaction-service", "payment-service", "worker-service"].every(
      (serviceName) => serviceNames.has(serviceName)
    ) &&
    operationNames.some((name) => name.startsWith("HTTP ")) &&
    operationNames.some((name) => name.startsWith("postgres.")) &&
    operationNames.some((name) => name.startsWith("redis.")) &&
    operationNames.some((name) => name.startsWith("rabbitmq."))
  );
}

async function queryLokiNumber(query: string, timeMs: number): Promise<number> {
  const result = await queryLoki(query, timeMs);
  const value = result[0]?.value?.[1];

  return value ? Number(value) : 0;
}

async function queryLokiSeries(
  query: string,
  timeMs: number
): Promise<Record<string, number>> {
  const result = await queryLoki(query, timeMs);

  return Object.fromEntries(
    result.map((series) => [
      series.metric?.service ?? "unknown",
      Number(series.value?.[1] ?? 0)
    ])
  );
}

async function queryLoki(query: string, timeMs: number): Promise<LokiVectorResult[]> {
  const url = new URL(`${lokiUrl}/loki/api/v1/query`);
  url.searchParams.set("query", query);
  url.searchParams.set("time", `${timeMs * 1_000_000}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Loki query returned ${response.status}`);
  }

  const payload = (await response.json()) as LokiVectorResponse;
  return payload.data?.result ?? [];
}

async function queryLokiSampleLines(
  startedAtMs: number,
  endedAtMs: number
): Promise<string[]> {
  const url = new URL(`${lokiUrl}/loki/api/v1/query_range`);
  url.searchParams.set("query", `{service=~".+"}`);
  url.searchParams.set("start", `${startedAtMs * 1_000_000}`);
  url.searchParams.set("end", `${endedAtMs * 1_000_000}`);
  url.searchParams.set("limit", "1000");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Loki sample query returned ${response.status}`);
  }

  const payload = (await response.json()) as LokiRangeResponse;

  return (payload.data?.result ?? [])
    .flatMap((stream) => stream.values ?? [])
    .map((value) => value[1]);
}

function percentageChange(current: number, baseline: number): number {
  if (baseline === 0) {
    return 0;
  }

  return ((current - baseline) / baseline) * 100;
}

function titleFromExperimentId(value: string): string {
  if (value === "metrics-logs-traces") {
    return "Metrics + Logs + Traces";
  }

  if (value === "otel-full") {
    return "Full OpenTelemetry Pipeline";
  }

  if (value === "metrics-logs") {
    return "Metrics + Logs";
  }

  if (value === "metrics-only") {
    return "Metrics Only";
  }

  return "Baseline Without Observability";
}

function telemetryConfigurationLines(mode: string): string[] {
  if (mode === "none") {
    return [
      "- Metrics: disabled",
      "- Structured app logs: disabled",
      "- Tracing: disabled",
      "- OpenTelemetry Collector: not included in the base Compose stack"
    ];
  }

  if (mode === "metrics") {
    return [
      "- Metrics: enabled",
      "- Structured app logs: disabled",
      "- Tracing: disabled",
      "- OpenTelemetry Collector: disabled",
      "- Prometheus/Grafana: enabled with the `metrics` Compose profile"
    ];
  }

  if (mode === "metrics_logs") {
    return [
      "- Metrics: enabled",
      "- Structured app logs: enabled",
      "- Correlation IDs: enabled",
      "- Tracing: disabled",
      "- OpenTelemetry Collector: disabled",
      "- Prometheus/Grafana/Loki: enabled with the `metrics` and `logs` Compose profiles"
    ];
  }

  if (mode === "metrics_logs_traces") {
    return [
      "- Metrics: enabled",
      "- Structured app logs: enabled",
      "- Correlation IDs: enabled",
      "- Tracing: enabled",
      "- Trace-log correlation: enabled through `trace_id` in JSON logs",
      "- Jaeger: enabled with the `traces` Compose profile",
      "- Prometheus/Grafana/Loki/Jaeger: enabled with the `metrics`, `logs`, and `traces` Compose profiles"
    ];
  }

  if (mode === "otel_full") {
    return [
      "- Metrics: routed through OpenTelemetry Collector Prometheus receiver/exporter",
      "- Structured app logs: exported from services to OpenTelemetry Collector over OTLP/HTTP",
      "- Correlation IDs: enabled",
      "- Tracing: exported from services to OpenTelemetry Collector over OTLP/HTTP",
      "- Trace-log correlation: enabled through `trace_id` in OTLP log records",
      "- Sampling ratio: controlled by `OTEL_TRACES_SAMPLER_ARG`",
      "- Prometheus/Grafana/Loki/Jaeger/OpenTelemetry Collector: enabled with the `metrics`, `logs`, `traces`, and `otel` Compose profiles"
    ];
  }

  return ["- Telemetry configuration: see experiment setup."];
}

function isLogMode(mode: string): boolean {
  return (
    mode === "metrics_logs" || mode === "metrics_logs_traces" || mode === "otel_full"
  );
}

function isTraceMode(mode: string): boolean {
  return mode === "metrics_logs_traces" || mode === "otel_full";
}

function isFullOpenTelemetryMode(mode: string | undefined): boolean {
  return mode === "otel_full";
}

function parsePercent(value: string | undefined): number {
  return Number((value ?? "0").replace("%", ""));
}

function parseMemoryBytes(value: string | undefined): number {
  const amount = (value ?? "0B").split("/")[0]?.trim() ?? "0B";
  const match = amount.match(/^([\d.]+)\s*([KMGT]?i?B|B)$/);

  if (!match) {
    return 0;
  }

  const size = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    B: 1,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4
  };

  return size * (multipliers[unit] ?? 1);
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

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, durationMs);
  });
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await runCommand("sh", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  executable: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; streamOutput?: boolean } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(executable, args, {
      cwd: workspaceRoot,
      env: options.env ?? process.env
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      if (options.streamOutput !== false) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      if (options.streamOutput !== false) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", rejectCommand);
    child.on("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };

      if (code === 0) {
        resolveCommand(result);
      } else {
        rejectCommand(
          new Error(`${executable} ${args.join(" ")} exited with code ${code}`)
        );
      }
    });
  });
}

type LokiVectorResponse = {
  data?: {
    result?: LokiVectorResult[];
  };
};

type LokiVectorResult = {
  metric?: {
    service?: string;
  };
  value?: [number, string];
};

type LokiRangeResponse = {
  data?: {
    result?: Array<{
      values?: Array<[string, string]>;
    }>;
  };
};

type JaegerTraceSearchResponse = {
  data?: JaegerTrace[];
};

type JaegerTrace = {
  traceID: string;
  spans: Array<{
    operationName: string;
    processID: string;
  }>;
  processes?: Record<
    string,
    {
      serviceName?: string;
    }
  >;
};

void main();
