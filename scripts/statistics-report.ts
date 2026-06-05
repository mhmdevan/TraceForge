import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderBoxPlot, type BoxStats } from "./lib/svg-chart";
import {
  cliffsDelta,
  ciOverlap,
  kruskalWallis,
  mannWhitneyU,
  mulberry32,
  summarize,
  type Summary
} from "./lib/stats";

// Statistical analysis pipeline (ISI-grade). Reads the per-mode experiment runs
// and produces non-parametric summaries (median/IQR, bootstrap 95% CI),
// significance tests (Mann-Whitney vs baseline, Kruskal-Wallis across modes),
// effect sizes (Cliff's delta), CI-overlap verdicts, box-plot figures, and a
// report — the analysis a journal reviewer expects. The numerics are unit-tested
// in scripts/lib/stats.spec.ts.

type Mode = { id: string; label: string; short: string; file: string };
type Metric = { key: string; label: string; unit: string; column: string; scale: number };

type Pairwise = {
  mode: string;
  medianOverheadPct: number;
  p: number;
  delta: number;
  magnitude: string;
  overlapsBaseline: boolean;
};

type MetricAnalysis = {
  metric: Metric;
  perMode: Array<{ mode: Mode; values: number[]; summary: Summary }>;
  kruskal: { h: number; df: number; p: number };
  pairwise: Pairwise[];
};

const MODES: Mode[] = [
  {
    id: "baseline",
    label: "Baseline (none)",
    short: "Baseline",
    file: "baseline-summary.csv"
  },
  { id: "metrics", label: "Metrics", short: "Metrics", file: "metrics-only-summary.csv" },
  {
    id: "metrics_logs",
    label: "Metrics + Logs",
    short: "M+L",
    file: "metrics-logs-summary.csv"
  },
  {
    id: "metrics_logs_traces",
    label: "Metrics + Logs + Traces",
    short: "M+L+T",
    file: "metrics-logs-traces-summary.csv"
  },
  {
    id: "otel_full",
    label: "Full OpenTelemetry",
    short: "OTel Full",
    file: "otel-full-summary.csv"
  }
];

const METRICS: Metric[] = [
  { key: "p50", label: "p50 latency", unit: "ms", column: "duration_p50_ms", scale: 1 },
  { key: "p95", label: "p95 latency", unit: "ms", column: "duration_p95_ms", scale: 1 },
  { key: "p99", label: "p99 latency", unit: "ms", column: "duration_p99_ms", scale: 1 },
  { key: "cpu", label: "Docker CPU", unit: "%", column: "avg_cpu_percent", scale: 1 },
  {
    key: "memory",
    label: "Max memory",
    unit: "MiB",
    column: "max_memory_bytes",
    scale: 1 / 1024 ** 2
  }
];

const SEED = 12345;
// "phase" analyses the original per-mode summaries; "load" analyses the realistic
// load-harness output (load-<mode>-summary.csv). Outputs are namespaced so the two
// datasets do not clobber each other.
const dataset = process.env.STATS_DATASET === "load" ? "load" : "phase";
const suffix = dataset === "load" ? "-load" : "";
const workspaceRoot = process.cwd();
const processedDir = resolve(workspaceRoot, "results", "processed");
const chartsDir = resolve(workspaceRoot, "results", "charts");
const reportPath = resolve(workspaceRoot, "docs", `statistics${suffix}-report.md`);

function fileFor(mode: Mode): string {
  return dataset === "load" ? `load-${mode.id}-summary.csv` : mode.file;
}

async function main(): Promise<void> {
  await mkdir(chartsDir, { recursive: true });

  const activeModes: Mode[] = [];
  for (const mode of MODES) {
    if (await exists(resolve(processedDir, fileFor(mode)))) {
      activeModes.push(mode);
    } else {
      console.log(`Skipping ${mode.id}: ${fileFor(mode)} not found.`);
    }
  }
  if (activeModes.length < 2) {
    throw new Error(
      `Need at least 2 modes with data for the "${dataset}" dataset; found ${activeModes.length}.`
    );
  }

  const rng = mulberry32(SEED);
  const valuesByMode = new Map<string, Map<string, number[]>>();
  for (const mode of activeModes) {
    valuesByMode.set(mode.id, await readModeValues(mode));
  }

  const analyses: MetricAnalysis[] = METRICS.map((metric) =>
    analyzeMetric(metric, activeModes, valuesByMode, rng)
  );

  const minN = Math.min(
    ...analyses.flatMap((a) => a.perMode.map((entry) => entry.summary.n))
  );

  await writeJson(analyses, minN);
  await writeCsv(analyses);
  const charts = await writeCharts(analyses);
  await writeReport(analyses, minN, charts);

  console.log(
    `Dataset "${dataset}": analyzed ${METRICS.length} metrics across ${activeModes.length} modes.`
  );
  console.log(`Min runs per mode (N): ${minN}`);
  console.log(`JSON: ${resolve(processedDir, `statistics${suffix}.json`)}`);
  console.log(`CSV: ${resolve(processedDir, `statistics${suffix}.csv`)}`);
  console.log(`Charts: ${charts.join(", ")}`);
  console.log(`Report: ${reportPath}`);
  if (minN < 10) {
    console.log(
      `NOTE: N=${minN} per mode is underpowered for inference. Re-run each mode ` +
        `>=10 times (randomized order) for publication-grade results.`
    );
  }
}

async function readModeValues(mode: Mode): Promise<Map<string, number[]>> {
  const content = await readFile(resolve(processedDir, fileFor(mode)), "utf8");
  const rows = parseCsv(content);
  const byMetric = new Map<string, number[]>();
  for (const metric of METRICS) {
    byMetric.set(
      metric.key,
      rows.map((row) => Number(row[metric.column]) * metric.scale).filter(Number.isFinite)
    );
  }
  return byMetric;
}

function analyzeMetric(
  metric: Metric,
  activeModes: Mode[],
  valuesByMode: Map<string, Map<string, number[]>>,
  rng: () => number
): MetricAnalysis {
  const perMode = activeModes.map((mode) => {
    const values = valuesByMode.get(mode.id)?.get(metric.key) ?? [];
    return { mode, values, summary: summarize(values, rng) };
  });

  const kruskal = kruskalWallis(perMode.map((entry) => entry.values));

  const baseline = perMode[0];
  const pairwise: Pairwise[] = perMode.slice(1).map((entry) => {
    const mw = mannWhitneyU(entry.values, baseline.values);
    const cd = cliffsDelta(entry.values, baseline.values);
    const baseMedian = baseline.summary.median;
    return {
      mode: entry.mode.id,
      medianOverheadPct:
        baseMedian === 0 ? 0 : ((entry.summary.median - baseMedian) / baseMedian) * 100,
      p: mw.p,
      delta: cd.delta,
      magnitude: cd.magnitude,
      overlapsBaseline: ciOverlap(entry.summary.ci95, baseline.summary.ci95)
    };
  });

  return { metric, perMode, kruskal, pairwise };
}

async function writeJson(analyses: MetricAnalysis[], minN: number): Promise<void> {
  const payload = {
    generatedAt: new Date().toISOString(),
    seed: SEED,
    bootstrapResamples: 5000,
    minRunsPerMode: minN,
    note:
      minN < 10
        ? "N per mode is below the recommended >=10; significance tests are underpowered."
        : "ok",
    metrics: analyses.map((analysis) => ({
      key: analysis.metric.key,
      label: analysis.metric.label,
      unit: analysis.metric.unit,
      kruskalWallis: analysis.kruskal,
      modes: analysis.perMode.map((entry) => ({
        id: entry.mode.id,
        ...entry.summary
      })),
      pairwiseVsBaseline: analysis.pairwise
    }))
  };
  await writeFile(
    resolve(processedDir, `statistics${suffix}.json`),
    `${JSON.stringify(payload, null, 2)}\n`
  );
}

async function writeCsv(analyses: MetricAnalysis[]): Promise<void> {
  const header = [
    "metric",
    "unit",
    "mode",
    "n",
    "median",
    "mean",
    "std",
    "iqr",
    "ci95_lo",
    "ci95_hi",
    "cv_percent",
    "median_overhead_pct_vs_baseline",
    "mannwhitney_p_vs_baseline",
    "cliffs_delta",
    "effect_magnitude",
    "ci_overlaps_baseline"
  ].join(",");

  const rows: string[] = [];
  for (const analysis of analyses) {
    const pairByMode = new Map(analysis.pairwise.map((p) => [p.mode, p]));
    for (const entry of analysis.perMode) {
      const pair = pairByMode.get(entry.mode.id);
      rows.push(
        [
          analysis.metric.key,
          analysis.metric.unit,
          entry.mode.id,
          entry.summary.n,
          round(entry.summary.median, 4),
          round(entry.summary.mean, 4),
          round(entry.summary.std, 4),
          round(entry.summary.iqr, 4),
          round(entry.summary.ci95[0], 4),
          round(entry.summary.ci95[1], 4),
          round(entry.summary.cv * 100, 2),
          pair ? round(pair.medianOverheadPct, 2) : 0,
          pair ? round(pair.p, 4) : "",
          pair ? round(pair.delta, 3) : "",
          pair ? pair.magnitude : "",
          pair ? (pair.overlapsBaseline ? "yes" : "no") : ""
        ].join(",")
      );
    }
  }

  await writeFile(
    resolve(processedDir, `statistics${suffix}.csv`),
    `${[header, ...rows].join("\n")}\n`
  );
}

async function writeCharts(analyses: MetricAnalysis[]): Promise<string[]> {
  const chartMetrics = ["p95", "cpu", "memory"];
  const files: string[] = [];

  for (const key of chartMetrics) {
    const analysis = analyses.find((a) => a.metric.key === key);
    if (!analysis) {
      continue;
    }
    const boxes: BoxStats[] = analysis.perMode.map((entry) => ({
      min: entry.summary.min,
      q1: entry.summary.q1,
      median: entry.summary.median,
      q3: entry.summary.q3,
      max: entry.summary.max,
      ciLo: entry.summary.ci95[0],
      ciHi: entry.summary.ci95[1]
    }));
    const file = `stats${suffix}-${key}-boxplot.svg`;
    await writeFile(
      resolve(chartsDir, file),
      renderBoxPlot({
        title: `${analysis.metric.label} distribution by observability mode`,
        subtitle: `Box = IQR, line = median, red bar = 95% CI of median (N=${boxes.length ? analysis.perMode[0].summary.n : 0} per mode)`,
        categories: analysis.perMode.map((entry) => entry.mode.short),
        boxes,
        yAxisLabel: analysis.metric.unit,
        format: (value) => value.toFixed(analysis.metric.key === "memory" ? 0 : 1)
      })
    );
    files.push(file);
  }
  return files;
}

async function writeReport(
  analyses: MetricAnalysis[],
  minN: number,
  charts: string[]
): Promise<void> {
  const lines: string[] = [];
  lines.push("# Statistical Analysis — Observability Overhead");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");

  if (minN < 10) {
    lines.push(
      `> **⚠️ Underpowered sample (N=${minN} per mode).** This pipeline produces ` +
        `publication-grade statistics, but the current per-mode results were captured ` +
        `with only ${minN} repetitions on a micro-benchmark load. The significance ` +
        `tests below are therefore **indicative, not conclusive**. For an ISI/journal ` +
        `submission, re-run each mode **≥10 times in randomized order** under a ` +
        `realistic steady-state load, then re-run \`pnpm stats:report\`. The numbers ` +
        `will populate identically — only the statistical power improves.`
    );
    lines.push("");
  }

  lines.push("## Method");
  lines.push("");
  lines.push(
    "Latency and resource distributions are non-normal, so the analysis is " +
      "non-parametric throughout:"
  );
  lines.push("");
  lines.push("- **Central tendency / spread:** median and IQR.");
  lines.push(
    "- **Uncertainty:** bootstrap **95% CI of the median** (5,000 resamples, seeded)."
  );
  lines.push("- **Across modes:** Kruskal–Wallis H test.");
  lines.push(
    "- **Vs baseline:** two-sided Mann–Whitney U with continuity + tie correction."
  );
  lines.push("- **Effect size:** Cliff's delta (negligible/small/medium/large).");
  lines.push(
    "- **Decision aid:** a mode whose 95% CI does **not** overlap the baseline's CI " +
      "differs from baseline with high confidence."
  );
  lines.push("");

  for (const analysis of analyses) {
    lines.push(`## ${analysis.metric.label} (${analysis.metric.unit})`);
    lines.push("");
    lines.push("| Mode | N | Median [95% CI] | IQR | CV% |");
    lines.push("| --- | ---: | --- | ---: | ---: |");
    for (const entry of analysis.perMode) {
      const s = entry.summary;
      lines.push(
        `| ${entry.mode.label} | ${s.n} | ${fmt(s.median)} [${fmt(s.ci95[0])}, ${fmt(s.ci95[1])}] | ` +
          `${fmt(s.iqr)} | ${(s.cv * 100).toFixed(1)} |`
      );
    }
    lines.push("");
    lines.push(
      `Kruskal–Wallis across modes: H = ${analysis.kruskal.h.toFixed(2)}, ` +
        `df = ${analysis.kruskal.df}, p = ${formatP(analysis.kruskal.p)}.`
    );
    lines.push("");
    lines.push(
      "| Mode vs baseline | Median overhead | Mann–Whitney p | Cliff's δ | CI overlaps baseline? |"
    );
    lines.push("| --- | ---: | ---: | --- | --- |");
    for (const pair of analysis.pairwise) {
      const mode = MODES.find((m) => m.id === pair.mode);
      lines.push(
        `| ${mode?.label ?? pair.mode} | ${signed(pair.medianOverheadPct)} | ` +
          `${formatP(pair.p)} | ${pair.delta.toFixed(2)} (${pair.magnitude}) | ` +
          `${pair.overlapsBaseline ? "yes" : "**no**"} |`
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

  lines.push("## How to read this");
  lines.push("");
  lines.push(
    "- A p-value alone is not enough: pair it with Cliff's δ (effect size) and the " +
      "CI-overlap column. A real, meaningful difference shows a small p, a non-negligible " +
      "δ, and non-overlapping CIs."
  );
  lines.push(
    "- With small N, even large observed differences can have wide CIs and unstable " +
      "p-values — which is exactly why the sample size must grow before publication."
  );
  lines.push("");
  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("pnpm stats:report");
  lines.push("```");
  lines.push("");
  lines.push(
    "Deterministic given the seed (bootstrap RNG is seeded). Inputs are the per-mode " +
      "`results/processed/*-summary.csv` files; re-run the experiments to refresh them."
  );
  lines.push("");

  await writeFile(reportPath, lines.join("\n"));
}

function parseCsv(content: string): Array<Record<string, string>> {
  const [headerLine, ...rest] = content.trim().split("\n");
  const headers = headerLine.split(",");
  return rest.filter(Boolean).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""])
    );
  });
}

function fmt(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  return value.toFixed(2);
}

function formatP(p: number): string {
  return p < 0.001 ? "<0.001" : p.toFixed(3);
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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
