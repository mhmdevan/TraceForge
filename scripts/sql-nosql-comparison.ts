import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { renderBarChart } from "./lib/svg-chart";

// Phase 11 — SQL vs NoSQL comparison.
//
// Reads the stored PostgreSQL (Phase 10) and MongoDB (Phase 11) indexing results
// and produces a careful, scoped comparison. It leads with the structural metric
// — rows/documents examined and scan type — which is directly comparable across
// engines, and treats latency as indicative only because the two experiments use
// different timing methodologies. Per the roadmap, no shallow "X is faster than Y"
// conclusions are drawn.

type EngineRow = {
  strategy: string;
  query: string;
  p95: number;
  examined: number;
  scanType: string;
  index: string;
};

type Best = EngineRow | undefined;

const workspaceRoot = process.cwd();
const processedDir = resolve(workspaceRoot, "results", "processed");
const chartsDir = resolve(workspaceRoot, "results", "charts");
const reportPath = resolve(workspaceRoot, "docs", "sql-nosql-comparison.md");

// Queries that exist in both experiments (Q5 PostgreSQL aggregate has no Mongo find equivalent).
const QUERIES = [
  { id: "Q1", description: "User transaction history" },
  { id: "Q2", description: "Status + time range (status='failed')" },
  { id: "Q3", description: "High-value transactions" },
  { id: "Q4", description: "User + status + time range" }
];

async function main(): Promise<void> {
  await mkdir(chartsDir, { recursive: true });

  const postgres = await loadEngine("postgres-indexing.csv", "rows_scanned");
  const mongo = await loadEngine("mongodb-indexing.csv", "docs_examined");

  const charts = await writeCharts(postgres, mongo);
  await writeReport(postgres, mongo, charts);

  console.log(`PostgreSQL rows: ${postgres.length}, MongoDB rows: ${mongo.length}`);
  console.log(`Charts: ${charts.join(", ")}`);
  console.log(`Report: ${reportPath}`);
}

async function loadEngine(file: string, examinedColumn: string): Promise<EngineRow[]> {
  const path = resolve(processedDir, file);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `Missing ${path}. Run the indexing experiment that produces it first.`
    );
  }

  const rows = parseCsv(content);
  return rows.map((row) => ({
    strategy: row.strategy,
    query: row.query,
    p95: Number(row.exec_p95_ms),
    examined: Number(row[examinedColumn]),
    scanType: row.scan_type,
    index: row.index_used
  }));
}

function baselineFor(rows: EngineRow[], queryId: string, baselineStrategy: string): Best {
  return rows.find((row) => row.query === queryId && row.strategy === baselineStrategy);
}

// Best index = fewest rows/docs examined among non-baseline strategies (ties to lower p95).
function bestFor(rows: EngineRow[], queryId: string, baselineStrategy: string): Best {
  const candidates = rows.filter(
    (row) => row.query === queryId && row.strategy !== baselineStrategy
  );
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates.reduce((a, b) => {
    if (a.examined !== b.examined) {
      return a.examined < b.examined ? a : b;
    }
    return a.p95 <= b.p95 ? a : b;
  });
}

async function writeCharts(postgres: EngineRow[], mongo: EngineRow[]): Promise<string[]> {
  const categories = QUERIES.map((query) => query.id);

  const pgBaselineExamined = QUERIES.map(
    (query) => baselineFor(postgres, query.id, "I0")?.examined ?? 0
  );
  const mongoBaselineExamined = QUERIES.map(
    (query) => baselineFor(mongo, query.id, "M0")?.examined ?? 0
  );
  const pgBestExamined = QUERIES.map(
    (query) => bestFor(postgres, query.id, "I0")?.examined ?? 0
  );
  const mongoBestExamined = QUERIES.map(
    (query) => bestFor(mongo, query.id, "M0")?.examined ?? 0
  );

  const charts: Array<{ file: string; svg: string }> = [
    {
      file: "sql-nosql-examined-baseline.svg",
      svg: renderBarChart({
        title: "Rows / Documents Examined — No Index",
        subtitle: "Both engines fall back to a full scan without a matching index",
        categories,
        yAxisLabel: "examined",
        format: (value) => value.toFixed(0),
        series: [
          { name: "PostgreSQL", color: "#336791", values: pgBaselineExamined },
          { name: "MongoDB", color: "#00ed64", values: mongoBaselineExamined }
        ]
      })
    },
    {
      file: "sql-nosql-examined-best.svg",
      svg: renderBarChart({
        title: "Rows / Documents Examined — Best Index",
        subtitle: "Fewest rows/docs examined among indexed strategies, lower is better",
        categories,
        yAxisLabel: "examined",
        format: (value) => value.toFixed(0),
        series: [
          { name: "PostgreSQL", color: "#336791", values: pgBestExamined },
          { name: "MongoDB", color: "#00ed64", values: mongoBestExamined }
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
  postgres: EngineRow[],
  mongo: EngineRow[],
  charts: string[]
): Promise<void> {
  const lines: string[] = [];

  lines.push("# PostgreSQL vs MongoDB Indexing Comparison");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push(
    "This compares the PostgreSQL (Phase 10) and MongoDB (Phase 11) indexing " +
      "experiments on equivalent query patterns and a comparable 100k-row/document " +
      "dataset. It deliberately leads with the **structural** metric — rows/documents " +
      "examined and scan type — which is directly comparable across engines. Latency " +
      "is reported as **indicative only**: the two experiments use different timing " +
      "methodologies (see Limitations), so absolute latency must not be read as one " +
      "engine being faster than the other."
  );
  lines.push("");
  lines.push(
    "Only the four `find`-style patterns shared by both experiments are compared; the " +
      "PostgreSQL Q5 aggregate has no equivalent in the MongoDB query set."
  );
  lines.push("");

  lines.push("## Structural Comparison (rows / documents examined)");
  lines.push("");
  lines.push(
    "| Query | PG no-index | PG best (index) | examined | Mongo no-index | Mongo best (index) | examined |"
  );
  lines.push("| --- | --- | --- | ---: | --- | --- | ---: |");
  for (const query of QUERIES) {
    const pgBase = baselineFor(postgres, query.id, "I0");
    const pgBest = bestFor(postgres, query.id, "I0");
    const mBase = baselineFor(mongo, query.id, "M0");
    const mBest = bestFor(mongo, query.id, "M0");
    lines.push(
      `| ${query.id} | ${pgBase?.scanType} (${num(pgBase?.examined)}) | ${pgBest?.strategy} ${pgBest?.scanType} | ` +
        `${num(pgBest?.examined)} | ${mBase?.scanType} (${num(mBase?.examined)}) | ${mBest?.strategy} ${mBest?.scanType} | ` +
        `${num(mBest?.examined)} |`
    );
  }
  lines.push("");

  lines.push("## Indicative Latency (p95, different timing methodologies)");
  lines.push("");
  lines.push(
    "> PostgreSQL p95 is server-side `EXPLAIN ANALYZE` execution time; MongoDB p95 is " +
      "client-side wall-clock. Compare within an engine, not across."
  );
  lines.push("");
  lines.push(
    "| Query | PG no-index p95 | PG best p95 | Mongo no-index p95 | Mongo best p95 |"
  );
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const query of QUERIES) {
    const pgBase = baselineFor(postgres, query.id, "I0");
    const pgBest = bestFor(postgres, query.id, "I0");
    const mBase = baselineFor(mongo, query.id, "M0");
    const mBest = bestFor(mongo, query.id, "M0");
    lines.push(
      `| ${query.id} | ${ms(pgBase?.p95)} | ${ms(pgBest?.p95)} | ${ms(mBase?.p95)} | ${ms(mBest?.p95)} |`
    );
  }
  lines.push("");

  lines.push("## Charts");
  lines.push("");
  for (const chart of charts) {
    lines.push(`![${chart}](../results/charts/${chart})`);
    lines.push("");
  }

  lines.push("## Scoped Observations");
  lines.push("");
  for (const query of QUERIES) {
    const pgBest = bestFor(postgres, query.id, "I0");
    const mBest = bestFor(mongo, query.id, "M0");
    const pgBase = baselineFor(postgres, query.id, "I0");
    const mBase = baselineFor(mongo, query.id, "M0");
    if (!pgBest || !mBest || !pgBase || !mBase) {
      continue;
    }
    lines.push(
      `- **${query.id} (${query.description})**: for this dataset and access pattern, ` +
        `PostgreSQL's best index (${pgBest.strategy}, ${pgBest.scanType}) examined ` +
        `${num(pgBest.examined)} rows vs ${num(pgBase.examined)} for the sequential scan; ` +
        `MongoDB's best index (${mBest.strategy}, ${mBest.scanType}) examined ` +
        `${num(mBest.examined)} documents vs ${num(mBase.examined)} for the collection scan. ` +
        `Both engines reduced work along the same structural lines.`
    );
  }
  lines.push("");

  lines.push("## Limitations");
  lines.push("");
  lines.push(
    "- **Timing methodology differs.** PostgreSQL latency is server-side `EXPLAIN " +
      "ANALYZE` execution time (sub-millisecond resolution); MongoDB latency is " +
      "client-side wall-clock including driver and loopback round-trip. Cross-engine " +
      "latency numbers are therefore not directly comparable — the structural " +
      "rows/documents-examined metric is the fair comparison."
  );
  lines.push(
    "- **Different engines and storage layers** (PostgreSQL heap + B-tree vs MongoDB " +
      "WiredTiger), pinned image versions, and default configurations."
  );
  lines.push(
    "- **Synthetic, uniformly-distributed data** with the same generator logic on both " +
      "sides; real-world skew would change selectivity and index value."
  );
  lines.push(
    "- **Same machine, single run per engine**; absolute numbers depend on hardware and " +
      "cache state. Conclusions are scoped to this dataset, access pattern, index " +
      "strategy, hardware, and load profile — not a general claim that one engine " +
      "indexes better than the other."
  );
  lines.push("");

  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("pnpm indexing:run     # PostgreSQL (Phase 10)");
  lines.push("pnpm indexing:mongo   # MongoDB (Phase 11)");
  lines.push("pnpm sql-nosql:report # this comparison");
  lines.push("```");
  lines.push("");

  await writeFile(reportPath, lines.join("\n"));
}

function parseCsv(content: string): Array<Record<string, string>> {
  const [headerLine, ...rest] = content.trim().split("\n");
  const headers = splitCsvLine(headerLine);
  return rest.filter(Boolean).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""])
    );
  });
}

// Minimal CSV line splitter that respects double-quoted fields (labels contain commas).
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function num(value: number | undefined): string {
  return value === undefined ? "—" : Math.round(value).toLocaleString();
}

function ms(value: number | undefined): string {
  return value === undefined ? "—" : `${value.toFixed(2)} ms`;
}

void main();
