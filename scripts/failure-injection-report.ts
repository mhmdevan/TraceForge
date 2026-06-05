import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderBarChart } from "./lib/svg-chart";

// Phase 9 — Failure Injection and Debuggability Measurement.
//
// This script turns recorded debugging observations (see
// docs/failure-injection-protocol.md) into a comparison report, CSV, and charts.
// It computes time-to-detect and time-to-root-cause from human-recorded
// timestamps; it never invents them. Until real runs are recorded it falls back
// to the illustrative example and stamps every output as NOT measured.

type ObservationRun = {
  mode: string;
  failureStartTimestamp: string;
  firstVisibleSymptomTimestamp: string;
  firstAlertTimestamp: string | null;
  rootCauseIdentifiedTimestamp: string;
  toolsUsed: string[];
  manualSteps: number;
  rootCauseAccuracy: string;
};

type Scenario = {
  id: string;
  title: string;
  service: string;
  expectedSymptom: string;
  bestTool: string;
  envFlags: Record<string, string>;
  runs: ObservationRun[];
};

type Observations = {
  status: string;
  note?: string;
  scenarios: Scenario[];
};

type RunResult = {
  scenario: Scenario;
  run: ObservationRun;
  detectSeconds: number;
  rootCauseSeconds: number;
};

const MODE_ORDER = [
  "none",
  "metrics",
  "metrics_logs",
  "metrics_logs_traces",
  "otel_full"
];
const MODE_LABELS: Record<string, string> = {
  none: "Baseline",
  metrics: "Metrics",
  metrics_logs: "M+L",
  metrics_logs_traces: "M+L+T",
  otel_full: "Full OTel"
};
const MODE_COLORS: Record<string, string> = {
  none: "#e15759",
  metrics: "#f28e2b",
  metrics_logs: "#edc948",
  metrics_logs_traces: "#4e79a7",
  otel_full: "#59a14f"
};

const workspaceRoot = process.cwd();
const experimentDir = resolve(workspaceRoot, "experiments", "failure-injection");
const processedDir = resolve(workspaceRoot, "results", "processed");
const chartsDir = resolve(workspaceRoot, "results", "charts");
const reportPath = resolve(workspaceRoot, "docs", "failure-injection-report.md");

async function main(): Promise<void> {
  await mkdir(processedDir, { recursive: true });
  await mkdir(chartsDir, { recursive: true });

  const { observations, sourcePath } = await loadObservations();
  const measured = observations.status === "measured";
  const results = computeResults(observations);

  await writeCsv(results, observations.status);
  const charts = await writeCharts(observations);
  await writeReport(observations, results, charts, sourcePath, measured);

  console.log(
    `Failure-injection report from ${sourcePath} (status: ${observations.status}).`
  );
  console.log(`Scenarios: ${observations.scenarios.length}, runs: ${results.length}`);
  console.log(`CSV: ${resolve(processedDir, "debuggability-results.csv")}`);
  console.log(`Charts: ${charts.join(", ")}`);
  console.log(`Report: ${reportPath}`);

  if (!measured) {
    console.log(
      "NOTE: outputs are based on illustrative example data. Record real runs in " +
        "experiments/failure-injection/observations.json (status: measured) to replace them."
    );
  }
}

async function loadObservations(): Promise<{
  observations: Observations;
  sourcePath: string;
}> {
  const explicit = process.env.FAILURE_OBSERVATIONS
    ? resolve(workspaceRoot, process.env.FAILURE_OBSERVATIONS)
    : undefined;
  const recorded = resolve(experimentDir, "observations.json");
  const example = resolve(experimentDir, "observations.example.json");
  const sourcePath = explicit ?? ((await exists(recorded)) ? recorded : example);

  const observations = JSON.parse(await readFile(sourcePath, "utf8")) as Observations;

  if (!Array.isArray(observations.scenarios) || observations.scenarios.length === 0) {
    throw new Error(`No scenarios found in ${sourcePath}.`);
  }

  return { observations, sourcePath };
}

function computeResults(observations: Observations): RunResult[] {
  return observations.scenarios.flatMap((scenario) =>
    scenario.runs.map((run) => ({
      scenario,
      run,
      detectSeconds: detectSeconds(run),
      rootCauseSeconds: secondsBetween(
        run.failureStartTimestamp,
        run.rootCauseIdentifiedTimestamp
      )
    }))
  );
}

function detectSeconds(run: ObservationRun): number {
  // Detection is the earlier of the first alert and the first visible symptom.
  const symptom = secondsBetween(
    run.failureStartTimestamp,
    run.firstVisibleSymptomTimestamp
  );

  if (run.firstAlertTimestamp) {
    const alert = secondsBetween(run.failureStartTimestamp, run.firstAlertTimestamp);
    return Math.min(symptom, alert);
  }

  return symptom;
}

async function writeCsv(results: RunResult[], status: string): Promise<void> {
  const header = [
    "scenario_id",
    "title",
    "service",
    "mode",
    "expected_symptom",
    "best_tool",
    "time_to_detect_seconds",
    "time_to_root_cause_seconds",
    "had_alert",
    "tools_used_count",
    "manual_steps",
    "root_cause_accuracy",
    "data_source"
  ].join(",");

  const rows = results.map((result) =>
    [
      result.scenario.id,
      csv(result.scenario.title),
      result.scenario.service,
      result.run.mode,
      csv(result.scenario.expectedSymptom),
      csv(result.scenario.bestTool),
      round(result.detectSeconds, 1),
      round(result.rootCauseSeconds, 1),
      result.run.firstAlertTimestamp ? "yes" : "no",
      result.run.toolsUsed.length,
      result.run.manualSteps,
      result.run.rootCauseAccuracy,
      status
    ].join(",")
  );

  await writeFile(
    resolve(processedDir, "debuggability-results.csv"),
    `${[header, ...rows].join("\n")}\n`
  );
}

async function writeCharts(observations: Observations): Promise<string[]> {
  const modes = orderedModes(observations);
  const categories = observations.scenarios.map((scenario) => scenario.id);

  const detectionSeries = modes.map((mode) => ({
    name: MODE_LABELS[mode] ?? mode,
    color: MODE_COLORS[mode] ?? "#9aa7b5",
    values: observations.scenarios.map((scenario) =>
      valueForMode(scenario, mode, (run) => detectSeconds(run))
    )
  }));

  const rootCauseSeries = modes.map((mode) => ({
    name: MODE_LABELS[mode] ?? mode,
    color: MODE_COLORS[mode] ?? "#9aa7b5",
    values: observations.scenarios.map((scenario) =>
      valueForMode(scenario, mode, (run) =>
        secondsBetween(run.failureStartTimestamp, run.rootCauseIdentifiedTimestamp)
      )
    )
  }));

  const charts: Array<{ file: string; svg: string }> = [
    {
      file: "detection-time.svg",
      svg: renderBarChart({
        title: "Failure Detection Time by Mode",
        subtitle:
          "Seconds from failure start to first visible symptom/alert (lower is better)",
        categories,
        yAxisLabel: "seconds",
        format: (value) => `${value.toFixed(0)}`,
        series: detectionSeries
      })
    },
    {
      file: "root-cause-time.svg",
      svg: renderBarChart({
        title: "Root-Cause Time by Mode",
        subtitle: "Seconds from failure start to identified root cause (lower is better)",
        categories,
        yAxisLabel: "seconds",
        format: (value) => `${value.toFixed(0)}`,
        series: rootCauseSeries
      })
    }
  ];

  for (const chart of charts) {
    await writeFile(resolve(chartsDir, chart.file), chart.svg);
  }

  return charts.map((chart) => chart.file);
}

async function writeReport(
  observations: Observations,
  results: RunResult[],
  charts: string[],
  sourcePath: string,
  measured: boolean
): Promise<void> {
  const lines: string[] = [];

  lines.push("# Failure Injection and Debuggability Report");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");

  if (!measured) {
    lines.push(
      `> **Illustrative example — NOT measured.** This report was generated from ` +
        `\`${relativePath(sourcePath)}\` (status: \`${observations.status}\`). The numbers ` +
        `are placeholders that demonstrate the tooling. Record real runs following ` +
        `docs/failure-injection-protocol.md and set \`status\` to \`measured\` to replace them.`
    );
    lines.push("");
  }

  lines.push("## Scenario Matrix");
  lines.push("");
  lines.push("| ID | Scenario | Service | Expected symptom | Best tool | Inject with |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const scenario of observations.scenarios) {
    lines.push(
      `| ${scenario.id} | ${scenario.title} | ${scenario.service} | ` +
        `${scenario.expectedSymptom} | ${scenario.bestTool} | ${flagText(scenario.envFlags)} |`
    );
  }
  lines.push("");

  lines.push("## Detection and Root-Cause Times");
  lines.push("");
  lines.push(
    "| Scenario | Mode | Detect (s) | Root cause (s) | Alert | Tools | Steps | Accuracy |"
  );
  lines.push("| --- | --- | ---: | ---: | --- | ---: | ---: | --- |");
  for (const result of results) {
    lines.push(
      `| ${result.scenario.id} | ${MODE_LABELS[result.run.mode] ?? result.run.mode} | ` +
        `${result.detectSeconds.toFixed(0)} | ${result.rootCauseSeconds.toFixed(0)} | ` +
        `${result.run.firstAlertTimestamp ? "yes" : "no"} | ${result.run.toolsUsed.length} | ` +
        `${result.run.manualSteps} | ${result.run.rootCauseAccuracy} |`
    );
  }
  lines.push("");

  const improvements = computeImprovements(observations);
  if (improvements.length > 0) {
    lines.push("## Debuggability Improvement (Full OTel vs Baseline)");
    lines.push("");
    lines.push(
      "| Scenario | Detect baseline (s) | Detect OTel (s) | Detect improvement | RC baseline (s) | RC OTel (s) | RC improvement |"
    );
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const improvement of improvements) {
      lines.push(
        `| ${improvement.id} | ${improvement.detectBaseline.toFixed(0)} | ` +
          `${improvement.detectOtel.toFixed(0)} | ${signed(improvement.detectImprovement)} | ` +
          `${improvement.rcBaseline.toFixed(0)} | ${improvement.rcOtel.toFixed(0)} | ` +
          `${signed(improvement.rcImprovement)} |`
      );
    }
    lines.push("");
    lines.push(
      `- Mean detection-time improvement: ${signed(mean(improvements.map((i) => i.detectImprovement)))}`
    );
    lines.push(
      `- Mean root-cause-time improvement: ${signed(mean(improvements.map((i) => i.rcImprovement)))}`
    );
    lines.push("");
  }

  lines.push("## Charts");
  lines.push("");
  for (const chart of charts) {
    lines.push(`![${chart}](../results/charts/${chart})`);
    lines.push("");
  }

  lines.push("## Root-Cause Accuracy");
  lines.push("");
  const accuracyByMode = accuracyCounts(results);
  lines.push("| Mode | correct | partial | incorrect |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const [mode, counts] of accuracyByMode) {
    lines.push(
      `| ${MODE_LABELS[mode] ?? mode} | ${counts.correct} | ${counts.partial} | ${counts.incorrect} |`
    );
  }
  lines.push("");

  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("pnpm failure:report");
  lines.push("```");
  lines.push("");
  lines.push(
    "See docs/failure-injection-protocol.md for how to inject each fault and record " +
      "the observations this report consumes."
  );
  lines.push("");

  await writeFile(reportPath, lines.join("\n"));
}

type Improvement = {
  id: string;
  detectBaseline: number;
  detectOtel: number;
  detectImprovement: number;
  rcBaseline: number;
  rcOtel: number;
  rcImprovement: number;
};

function computeImprovements(observations: Observations): Improvement[] {
  const improvements: Improvement[] = [];

  for (const scenario of observations.scenarios) {
    const baseline = scenario.runs.find((run) => run.mode === "none");
    const otel = scenario.runs.find((run) => run.mode === "otel_full");

    if (!baseline || !otel) {
      continue;
    }

    const detectBaseline = detectSeconds(baseline);
    const detectOtel = detectSeconds(otel);
    const rcBaseline = secondsBetween(
      baseline.failureStartTimestamp,
      baseline.rootCauseIdentifiedTimestamp
    );
    const rcOtel = secondsBetween(
      otel.failureStartTimestamp,
      otel.rootCauseIdentifiedTimestamp
    );

    improvements.push({
      id: scenario.id,
      detectBaseline,
      detectOtel,
      detectImprovement: reductionPercent(detectBaseline, detectOtel),
      rcBaseline,
      rcOtel,
      rcImprovement: reductionPercent(rcBaseline, rcOtel)
    });
  }

  return improvements;
}

function accuracyCounts(
  results: RunResult[]
): Array<[string, { correct: number; partial: number; incorrect: number }]> {
  const counts = new Map<
    string,
    { correct: number; partial: number; incorrect: number }
  >();

  for (const result of results) {
    const entry = counts.get(result.run.mode) ?? { correct: 0, partial: 0, incorrect: 0 };
    if (result.run.rootCauseAccuracy === "correct") entry.correct += 1;
    else if (result.run.rootCauseAccuracy === "partial") entry.partial += 1;
    else entry.incorrect += 1;
    counts.set(result.run.mode, entry);
  }

  return [...counts.entries()].sort(
    (a, b) => MODE_ORDER.indexOf(a[0]) - MODE_ORDER.indexOf(b[0])
  );
}

function orderedModes(observations: Observations): string[] {
  const present = new Set<string>();
  for (const scenario of observations.scenarios) {
    for (const run of scenario.runs) {
      present.add(run.mode);
    }
  }

  return MODE_ORDER.filter((mode) => present.has(mode)).concat(
    [...present].filter((mode) => !MODE_ORDER.includes(mode))
  );
}

function valueForMode(
  scenario: Scenario,
  mode: string,
  selector: (run: ObservationRun) => number
): number {
  const run = scenario.runs.find((candidate) => candidate.mode === mode);
  return run ? selector(run) : 0;
}

function secondsBetween(start: string, end: string): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error(`Invalid timestamp pair: "${start}" / "${end}"`);
  }

  return (endMs - startMs) / 1000;
}

function reductionPercent(baseline: number, observed: number): number {
  if (baseline === 0) {
    return 0;
  }

  return ((baseline - observed) / baseline) * 100;
}

function flagText(flags: Record<string, string>): string {
  return Object.entries(flags)
    .map(([key, value]) => `\`${key}=${value}\``)
    .join(" ");
}

function relativePath(absolutePath: string): string {
  return absolutePath.startsWith(workspaceRoot)
    ? absolutePath.slice(workspaceRoot.length + 1)
    : absolutePath;
}

function csv(value: string): string {
  return value.includes(",") ? `"${value}"` : value;
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

void main();
