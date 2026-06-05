import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MongoClient, type Collection, type Document, type Sort } from "mongodb";
import { renderBarChart } from "./lib/svg-chart";
import { bootstrapCI } from "./lib/stats";

// Phase 11 — MongoDB / NoSQL Indexing Experiments.
//
// Mirrors the PostgreSQL experiment (scripts/run-postgres-indexing.ts) on a
// comparable 100k-document dataset: for each index strategy (M0–M5) and query
// pattern (Q1–Q4) it captures a real explain("executionStats") plan plus
// client-side latency percentiles, index size, and write penalty. Read
// improvement and write penalty are reported separately. Nothing is fabricated.

type Strategy = {
  id: string;
  label: string;
  description: string;
  index: Document | null; // index key spec, or null for the no-index baseline
};

type IndexedQuery = {
  id: string;
  description: string;
  filter: Document;
  sort?: Sort;
  limit?: number;
};

type ScanInfo = {
  scanType: string;
  indexName: string | null;
  docsExamined: number;
  keysExamined: number;
  nReturned: number;
  inMemorySort: boolean;
};

type QueryResult = {
  strategy: Strategy;
  query: IndexedQuery;
  execP50Ms: number;
  execP95Ms: number;
  execP95CiLo: number;
  execP95CiHi: number;
  execP99Ms: number;
  execMeanMs: number;
  scan: ScanInfo;
};

type StrategyResult = {
  strategy: Strategy;
  indexSizeBytes: number;
  writeLatencyMs: number;
};

const mongoUrl = process.env.MONGO_URL ?? "mongodb://localhost:27117";
const mongoDb = process.env.MONGO_DB ?? "traceforge_indexing";
const documentCount = toInt(process.env.INDEXING_TRANSACTIONS, 100000);
const userCount = toInt(process.env.INDEXING_USERS, 10000);
const reps = toInt(process.env.INDEXING_REPS, 25);
const writeBatch = toInt(process.env.INDEXING_WRITE_BATCH, 1000);
const writeReps = toInt(process.env.INDEXING_WRITE_REPS, 3);
const seed = toInt(process.env.INDEXING_SEED_INT, 42);
// Separate seeded RNG for the (reproducible) bootstrap 95% CI of the p95 query time.
const bootstrapRng = mulberry32(12345);

const COLLECTION = "transactions";
const DAY_MS = 86_400_000;
const nowMs = Date.now();
const dayOffset = (days: number): Date => new Date(nowMs - days * DAY_MS);

const workspaceRoot = process.cwd();
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const rawDir = resolve(workspaceRoot, "results", "raw", `mongo-indexing-${timestamp}`);
const processedDir = resolve(workspaceRoot, "results", "processed");
const chartsDir = resolve(workspaceRoot, "results", "charts");
const reportPath = resolve(workspaceRoot, "docs", "mongodb-indexing-report.md");

const STRATEGIES: Strategy[] = [
  {
    id: "M0",
    label: "No index",
    description: "Baseline — no secondary index",
    index: null
  },
  {
    id: "M1",
    label: "userId",
    description: "Single field on userId",
    index: { userId: 1 }
  },
  {
    id: "M2",
    label: "createdAt",
    description: "Single field on createdAt",
    index: { createdAt: 1 }
  },
  {
    id: "M3",
    label: "userId, createdAt desc",
    description: "Compound for user history",
    index: { userId: 1, createdAt: -1 }
  },
  {
    id: "M4",
    label: "status, createdAt",
    description: "Compound for status + time range",
    index: { status: 1, createdAt: 1 }
  },
  {
    id: "M5",
    label: "userId, status, createdAt desc",
    description: "Compound covering user + status + time",
    index: { userId: 1, status: 1, createdAt: -1 }
  }
];

const QUERIES: IndexedQuery[] = [
  {
    id: "Q1",
    description: "User transaction history (userId, sort createdAt desc, limit 50)",
    filter: { userId: "user-1" },
    sort: { createdAt: -1 },
    limit: 50
  },
  {
    id: "Q2",
    description: "Status + time range (status='failed')",
    filter: {
      status: "failed",
      createdAt: { $gte: dayOffset(200), $lte: dayOffset(100) }
    }
  },
  {
    id: "Q3",
    description: "High-value transactions (amount > 900 AND recent)",
    filter: { amount: { $gt: 900 }, createdAt: { $gte: dayOffset(180) } }
  },
  {
    id: "Q4",
    description: "User + status + time range",
    filter: {
      userId: "user-1",
      status: "approved",
      createdAt: { $gte: dayOffset(300), $lte: new Date(nowMs) }
    }
  }
];

async function main(): Promise<void> {
  await mkdir(rawDir, { recursive: true });
  await mkdir(processedDir, { recursive: true });
  await mkdir(chartsDir, { recursive: true });

  const client = new MongoClient(mongoUrl);
  await client.connect();

  try {
    const collection = client.db(mongoDb).collection(COLLECTION);
    await ensureDataset(collection);

    const queryResults: QueryResult[] = [];
    const strategyResults: StrategyResult[] = [];

    for (const strategy of STRATEGIES) {
      await applyStrategy(collection, strategy);
      console.log(`Strategy ${strategy.id} (${strategy.label})`);

      strategyResults.push({
        strategy,
        indexSizeBytes: await strategyIndexSize(collection),
        writeLatencyMs: await measureWriteLatency(collection)
      });

      for (const query of QUERIES) {
        queryResults.push(await measureQuery(collection, strategy, query));
      }
    }

    await writeRaw(collection);
    await writeProcessedCsv(queryResults, strategyResults);
    const charts = await writeCharts(queryResults, strategyResults);
    await writeReport(queryResults, strategyResults, charts);

    console.log(`\nRaw plans: ${rawDir}`);
    console.log(`Processed CSV: ${resolve(processedDir, "mongodb-indexing.csv")}`);
    console.log(`Charts: ${charts.join(", ")}`);
    console.log(`Report: ${reportPath}`);
  } finally {
    await client.close();
  }
}

async function ensureDataset(collection: Collection): Promise<void> {
  const existing = await collection.estimatedDocumentCount();

  if (existing === documentCount) {
    console.log(`Dataset already seeded with ${existing} documents.`);
    return;
  }

  console.log(`Seeding ${documentCount} documents (${userCount} users)...`);
  await collection.deleteMany({});

  const random = mulberry32(seed);
  const chunkSize = 5000;
  let inserted = 0;

  while (inserted < documentCount) {
    const batch = Math.min(chunkSize, documentCount - inserted);
    await collection.insertMany(buildDocuments(batch, random), { ordered: false });
    inserted += batch;
  }

  console.log("Seed complete.");
}

function buildDocuments(count: number, random: () => number): Document[] {
  const countries = ["FI", "US", "DE", "BR", "IN"];
  const devices = ["web", "mobile"];
  const risks = ["low", "medium", "high"];
  const types = ["transfer", "payment", "deposit"];
  const docs: Document[] = [];

  for (let index = 0; index < count; index += 1) {
    const rs = random();
    docs.push({
      userId: `user-${1 + Math.floor(random() * userCount)}`,
      walletId: `wallet-${1 + Math.floor(random() * userCount)}`,
      amount: Math.round(random() * 1000 * 100) / 100,
      currency: "USD",
      status:
        rs < 0.1 ? "failed" : rs < 0.3 ? "pending" : rs < 0.6 ? "declined" : "approved",
      type: types[Math.floor(random() * types.length)],
      createdAt: new Date(nowMs - random() * 365 * DAY_MS),
      updatedAt: new Date(nowMs),
      metadata: {
        country: countries[Math.floor(random() * countries.length)],
        device: devices[Math.floor(random() * devices.length)],
        riskLevel: risks[Math.floor(random() * risks.length)]
      }
    });
  }

  return docs;
}

async function applyStrategy(collection: Collection, strategy: Strategy): Promise<void> {
  const indexes = await collection.indexes();
  for (const index of indexes) {
    if (index.name && index.name !== "_id_") {
      await collection.dropIndex(index.name);
    }
  }

  if (strategy.index) {
    await collection.createIndex(strategy.index);
  }
}

async function measureQuery(
  collection: Collection,
  strategy: Strategy,
  query: IndexedQuery
): Promise<QueryResult> {
  const times: number[] = [];

  for (let rep = 0; rep < reps; rep += 1) {
    const startedAt = process.hrtime.bigint();
    await runCursor(collection, query).toArray();
    times.push(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
  }

  const scan = parseExplain(await runCursor(collection, query).explain("executionStats"));
  const [ciLo, ciHi] = bootstrapCI(times, bootstrapRng, {
    statistic: (sample) => percentile(sample, 95)
  });

  return {
    strategy,
    query,
    execP50Ms: percentile(times, 50),
    execP95Ms: percentile(times, 95),
    execP95CiLo: ciLo,
    execP95CiHi: ciHi,
    execP99Ms: percentile(times, 99),
    execMeanMs: mean(times),
    scan
  };
}

function runCursor(collection: Collection, query: IndexedQuery) {
  return collection.find(query.filter, {
    ...(query.sort ? { sort: query.sort } : {}),
    ...(query.limit ? { limit: query.limit } : {})
  });
}

type ExplainStage = {
  stage?: string;
  indexName?: string;
  inputStage?: ExplainStage;
  inputStages?: ExplainStage[];
};

type ExplainResult = {
  executionStats?: {
    executionTimeMillis?: number;
    totalDocsExamined?: number;
    totalKeysExamined?: number;
    nReturned?: number;
    executionStages?: ExplainStage;
  };
};

function parseExplain(explain: Document): ScanInfo {
  const stats = (explain as ExplainResult).executionStats;
  const root = stats?.executionStages;
  const stages = collectStages(root);
  const scanStage = stages.find(
    (stage) => stage.stage === "IXSCAN" || stage.stage === "COLLSCAN"
  );

  return {
    scanType: scanStage?.stage ?? root?.stage ?? "UNKNOWN",
    indexName: stages.find((stage) => stage.indexName)?.indexName ?? null,
    docsExamined: stats?.totalDocsExamined ?? 0,
    keysExamined: stats?.totalKeysExamined ?? 0,
    nReturned: stats?.nReturned ?? 0,
    inMemorySort: stages.some((stage) => stage.stage === "SORT")
  };
}

function collectStages(stage: ExplainStage | undefined): ExplainStage[] {
  if (!stage) {
    return [];
  }

  const children = stage.inputStages ?? (stage.inputStage ? [stage.inputStage] : []);
  return [stage, ...children.flatMap(collectStages)];
}

async function measureWriteLatency(collection: Collection): Promise<number> {
  const random = mulberry32(seed + 1);
  const samples: number[] = [];

  // Warm-up insert (discarded) so the first measured strategy is not cold-biased.
  const warmup = await collection.insertMany(buildDocuments(writeBatch, random), {
    ordered: false
  });
  await collection.deleteMany({ _id: { $in: Object.values(warmup.insertedIds) } });

  for (let rep = 0; rep < writeReps; rep += 1) {
    const docs = buildDocuments(writeBatch, random);
    const startedAt = process.hrtime.bigint();
    const result = await collection.insertMany(docs, { ordered: false });
    samples.push(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
    await collection.deleteMany({ _id: { $in: Object.values(result.insertedIds) } });
  }

  return mean(samples);
}

async function strategyIndexSize(collection: Collection): Promise<number> {
  const stats = (await collection
    .aggregate([{ $collStats: { storageStats: {} } }])
    .toArray()) as Document[];
  const indexSizes = (stats[0]?.storageStats?.indexSizes ?? {}) as Record<string, number>;

  return Object.entries(indexSizes)
    .filter(([name]) => name !== "_id_")
    .reduce((total, [, size]) => total + Number(size), 0);
}

async function writeRaw(collection: Collection): Promise<void> {
  await writeFile(
    resolve(rawDir, "meta.json"),
    `${JSON.stringify(
      {
        mongoUrl: mongoUrl.replace(/:\/\/[^@]+@/, "://***@"),
        mongoDb,
        documentCount,
        userCount,
        reps,
        writeBatch,
        writeReps,
        seed,
        strategies: STRATEGIES.map((s) => ({ id: s.id, index: s.index })),
        queries: QUERIES.map((q) => ({
          id: q.id,
          filter: q.filter,
          sort: q.sort,
          limit: q.limit
        }))
      },
      null,
      2
    )}\n`
  );

  for (const strategy of STRATEGIES) {
    await applyStrategy(collection, strategy);
    for (const query of QUERIES) {
      const explain = await runCursor(collection, query).explain("executionStats");
      await writeFile(
        resolve(rawDir, `explain-${strategy.id}-${query.id}.json`),
        `${JSON.stringify(explain, null, 2)}\n`
      );
    }
  }
}

async function writeProcessedCsv(
  results: QueryResult[],
  strategyResults: StrategyResult[]
): Promise<void> {
  const baseline = new Map<string, QueryResult>();
  for (const result of results) {
    if (result.strategy.id === "M0") {
      baseline.set(result.query.id, result);
    }
  }
  const sizeByStrategy = new Map(
    strategyResults.map((entry) => [entry.strategy.id, entry])
  );

  const header = [
    "strategy",
    "strategy_label",
    "query",
    "exec_p50_ms",
    "exec_p95_ms",
    "exec_p95_ci_lo",
    "exec_p95_ci_hi",
    "exec_p99_ms",
    "exec_mean_ms",
    "scan_type",
    "index_used",
    "docs_examined",
    "keys_examined",
    "docs_returned",
    "in_memory_sort",
    "read_improvement_pct_vs_m0",
    "index_size_bytes",
    "write_latency_ms"
  ].join(",");

  const rows = results.map((result) => {
    const base = baseline.get(result.query.id);
    const improvement =
      base && base.execP95Ms > 0
        ? ((base.execP95Ms - result.execP95Ms) / base.execP95Ms) * 100
        : 0;
    const strategyEntry = sizeByStrategy.get(result.strategy.id);

    return [
      result.strategy.id,
      csv(result.strategy.label),
      result.query.id,
      round(result.execP50Ms, 3),
      round(result.execP95Ms, 3),
      round(result.execP95CiLo, 3),
      round(result.execP95CiHi, 3),
      round(result.execP99Ms, 3),
      round(result.execMeanMs, 3),
      result.scan.scanType,
      result.scan.indexName ?? "none",
      result.scan.docsExamined,
      result.scan.keysExamined,
      result.scan.nReturned,
      result.scan.inMemorySort ? "yes" : "no",
      round(improvement, 2),
      strategyEntry?.indexSizeBytes ?? 0,
      round(strategyEntry?.writeLatencyMs ?? 0, 3)
    ].join(",");
  });

  await writeFile(
    resolve(processedDir, "mongodb-indexing.csv"),
    `${[header, ...rows].join("\n")}\n`
  );
}

async function writeCharts(
  results: QueryResult[],
  strategyResults: StrategyResult[]
): Promise<string[]> {
  const strategyLabels = STRATEGIES.map((strategy) => strategy.id);
  const colors = ["#9aa7b5", "#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2"];

  const lookup = (queryId: string, strategyId: string): number => {
    const found = results.find(
      (result) => result.query.id === queryId && result.strategy.id === strategyId
    );
    return found ? found.execP95Ms : 0;
  };
  const docsLookup = (queryId: string, strategyId: string): number => {
    const found = results.find(
      (result) => result.query.id === queryId && result.strategy.id === strategyId
    );
    return found ? found.scan.docsExamined : 0;
  };

  const charts: Array<{ file: string; svg: string }> = [
    {
      file: "mongo-query-p95.svg",
      svg: renderBarChart({
        title: "MongoDB Query Latency p95 by Index Strategy",
        subtitle: "Client-side latency over repeated runs, lower is better",
        categories: QUERIES.map((query) => query.id),
        yAxisLabel: "ms",
        format: (value) => value.toFixed(2),
        series: STRATEGIES.map((strategy, index) => ({
          name: strategy.id,
          color: colors[index % colors.length],
          values: QUERIES.map((query) => lookup(query.id, strategy.id))
        }))
      })
    },
    {
      file: "mongo-docs-examined.svg",
      svg: renderBarChart({
        title: "MongoDB Documents Examined by Index Strategy",
        subtitle: "explain() totalDocsExamined — the structural cost, lower is better",
        categories: QUERIES.map((query) => query.id),
        yAxisLabel: "docs examined",
        format: (value) => value.toFixed(0),
        series: STRATEGIES.map((strategy, index) => ({
          name: strategy.id,
          color: colors[index % colors.length],
          values: QUERIES.map((query) => docsLookup(query.id, strategy.id))
        }))
      })
    },
    {
      file: "mongo-write-penalty.svg",
      svg: renderBarChart({
        title: "MongoDB Write Latency by Index Strategy",
        subtitle: `Time to insert ${writeBatch} documents (index maintenance), lower is better`,
        categories: strategyLabels,
        yAxisLabel: "ms",
        format: (value) => value.toFixed(1),
        series: [
          {
            name: "Write latency (ms)",
            color: "#e15759",
            values: strategyResults.map((entry) => entry.writeLatencyMs)
          }
        ]
      })
    },
    {
      file: "mongo-index-size.svg",
      svg: renderBarChart({
        title: "MongoDB Index Size by Strategy",
        subtitle: "On-disk size of the secondary index",
        categories: strategyLabels,
        yAxisLabel: "MiB",
        format: (value) => value.toFixed(2),
        series: [
          {
            name: "Index size (MiB)",
            color: "#76b7b2",
            values: strategyResults.map((entry) => entry.indexSizeBytes / 1024 ** 2)
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
  results: QueryResult[],
  strategyResults: StrategyResult[],
  charts: string[]
): Promise<void> {
  const baselineWrite =
    strategyResults.find((entry) => entry.strategy.id === "M0")?.writeLatencyMs ?? 0;
  const lines: string[] = [];

  lines.push("# MongoDB Indexing Report");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push(
    `This experiment measures how MongoDB index strategies affect query latency and ` +
      `write cost on a ${documentCount.toLocaleString()}-document collection across ` +
      `${userCount.toLocaleString()} users — the NoSQL counterpart to the PostgreSQL ` +
      `indexing experiment. For every strategy × query it captures a real ` +
      `\`explain("executionStats")\` plan plus client-side latency percentiles over ` +
      `${reps} runs.`
  );
  lines.push("");
  lines.push(`- Index strategies: ${STRATEGIES.length}`);
  lines.push(`- Query patterns: ${QUERIES.length}`);
  lines.push(`- Combinations: ${STRATEGIES.length * QUERIES.length}`);
  lines.push(`- Repetitions per combination: ${reps}`);
  lines.push("");

  lines.push("## Index Strategies");
  lines.push("");
  lines.push(
    "| Strategy | Index | Index size (MiB) | Write latency (ms) | Write penalty vs M0 |"
  );
  lines.push("| --- | --- | ---: | ---: | ---: |");
  for (const entry of strategyResults) {
    const penalty =
      baselineWrite > 0
        ? ((entry.writeLatencyMs - baselineWrite) / baselineWrite) * 100
        : 0;
    lines.push(
      `| ${entry.strategy.id} | ${entry.strategy.description} | ` +
        `${(entry.indexSizeBytes / 1024 ** 2).toFixed(2)} | ${entry.writeLatencyMs.toFixed(1)} | ` +
        `${signed(penalty)} |`
    );
  }
  lines.push("");

  lines.push("## Query Patterns");
  lines.push("");
  lines.push("| Query | Description |");
  lines.push("| --- | --- |");
  for (const query of QUERIES) {
    lines.push(`| ${query.id} | ${query.description} |`);
  }
  lines.push("");

  lines.push("## Read Performance by Query");
  lines.push("");
  for (const query of QUERIES) {
    lines.push(`### ${query.id} — ${query.description}`);
    lines.push("");
    lines.push(
      "| Strategy | p95 [95% CI] (ms) | stage | index used | docs examined | improvement vs M0 |"
    );
    lines.push("| --- | --- | --- | --- | ---: | ---: |");
    const baseline = results.find(
      (result) => result.query.id === query.id && result.strategy.id === "M0"
    );
    for (const strategy of STRATEGIES) {
      const result = results.find(
        (entry) => entry.query.id === query.id && entry.strategy.id === strategy.id
      );
      if (!result) {
        continue;
      }
      const improvement =
        baseline && baseline.execP95Ms > 0
          ? ((baseline.execP95Ms - result.execP95Ms) / baseline.execP95Ms) * 100
          : 0;
      const stage = result.scan.inMemorySort
        ? `${result.scan.scanType}+SORT`
        : result.scan.scanType;
      lines.push(
        `| ${strategy.id} | ${result.execP95Ms.toFixed(3)} [${result.execP95CiLo.toFixed(3)}, ${result.execP95CiHi.toFixed(3)}] | ${stage} | ` +
          `${result.scan.indexName ?? "none"} | ${result.scan.docsExamined.toLocaleString()} | ` +
          `${signed(improvement)} |`
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

  lines.push("## Findings");
  lines.push("");
  for (const finding of buildFindings(results, strategyResults, baselineWrite)) {
    lines.push(`- ${finding}`);
  }
  lines.push("");

  lines.push("## Threats to Validity");
  lines.push("");
  lines.push(
    "- Latency is client-side wall-clock against a local container, so it includes " +
      "driver and loopback round-trip; `explain()` documents-examined and stage are the " +
      "cleaner structural signal and are emphasised in the comparison."
  );
  lines.push(
    "- The dataset is synthetic with a uniform user distribution (~" +
      Math.round(documentCount / userCount) +
      " docs/user); skewed real-world data changes index selectivity."
  );
  lines.push(
    "- Write latency is a batch insert measured then deleted; it captures index " +
      "maintenance, not background compaction or long-term storage growth."
  );
  lines.push(
    "- Results are tied to the WiredTiger storage engine and the pinned MongoDB image."
  );
  lines.push("");

  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("# Requires a reachable MongoDB (MONGO_URL, default port 27117)");
  lines.push("pnpm indexing:mongo");
  lines.push("```");
  lines.push("");
  lines.push(
    'Raw `explain("executionStats")` plans for every combination are stored under ' +
      "`results/raw/mongo-indexing-<timestamp>/`. See `docs/sql-nosql-comparison.md` for " +
      "the careful PostgreSQL-vs-MongoDB comparison."
  );
  lines.push("");

  await writeFile(reportPath, lines.join("\n"));
}

function buildFindings(
  results: QueryResult[],
  strategyResults: StrategyResult[],
  baselineWrite: number
): string[] {
  const findings: string[] = [];

  for (const query of QUERIES) {
    const baseline = results.find(
      (result) => result.query.id === query.id && result.strategy.id === "M0"
    );
    const candidates = results.filter(
      (result) => result.query.id === query.id && result.strategy.id !== "M0"
    );
    if (!baseline || candidates.length === 0) {
      continue;
    }
    const best = candidates.reduce((a, b) =>
      a.scan.docsExamined <= b.scan.docsExamined ? a : b
    );
    findings.push(
      `${query.id}: best strategy ${best.strategy.id} (${best.scan.scanType}) examined ` +
        `${best.scan.docsExamined.toLocaleString()} docs vs ${baseline.scan.docsExamined.toLocaleString()} ` +
        `for the no-index COLLSCAN.`
    );
  }

  const heaviestWrite = strategyResults
    .filter((entry) => entry.strategy.id !== "M0")
    .reduce((a, b) => (a.writeLatencyMs >= b.writeLatencyMs ? a : b));
  if (baselineWrite > 0) {
    findings.push(
      `Write penalty: the heaviest index, ${heaviestWrite.strategy.id}, added ` +
        `${signed(((heaviestWrite.writeLatencyMs - baselineWrite) / baselineWrite) * 100)} ` +
        `insert latency vs the no-index baseline.`
    );
  }

  return findings;
}

// Deterministic PRNG so the dataset is reproducible across runs.
function mulberry32(a: number): () => number {
  let state = a >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function csv(value: string): string {
  return value.includes(",") ? `"${value}"` : value;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? `${fallback}`, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

void main();
