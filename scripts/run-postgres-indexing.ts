import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { renderBarChart } from "./lib/svg-chart";
import { bootstrapCI, mulberry32 } from "./lib/stats";

// Phase 10 — PostgreSQL Indexing Experiments.
//
// Seeds a controlled transaction dataset, then for each index strategy (I0–I6)
// and query pattern (Q1–Q5) captures a real EXPLAIN (ANALYZE, BUFFERS) plan,
// execution-time percentiles over repeated runs, index size, and write penalty.
// Read improvement and write penalty are reported separately. Nothing is
// fabricated — every number comes from the live database.

type Strategy = {
  id: string;
  label: string;
  description: string;
  indexes: string[]; // CREATE INDEX statements (dropped/rebuilt per strategy)
};

type Query = {
  id: string;
  description: string;
  sql: string;
};

type ScanInfo = {
  nodeType: string;
  indexName: string | null;
  actualRows: number;
  rowsScanned: number;
};

type QueryResult = {
  strategy: Strategy;
  query: Query;
  execP50Ms: number;
  execP95Ms: number;
  execP95CiLo: number;
  execP95CiHi: number;
  execP99Ms: number;
  execMeanMs: number;
  planRows: number;
  actualRows: number;
  scan: ScanInfo;
};

type StrategyResult = {
  strategy: Strategy;
  indexSizeBytes: number;
  writeLatencyMs: number;
};

const databaseUrl =
  process.env.INDEXING_DATABASE_URL ??
  "postgres://traceforge:traceforge@localhost:15499/traceforge_indexing";
const transactionCount = toInt(process.env.INDEXING_TRANSACTIONS, 100000);
const userCount = toInt(process.env.INDEXING_USERS, 10000);
const reps = toInt(process.env.INDEXING_REPS, 25);
const writeBatch = toInt(process.env.INDEXING_WRITE_BATCH, 1000);
const writeReps = toInt(process.env.INDEXING_WRITE_REPS, 3);
const seed = Number(process.env.INDEXING_SEED ?? 0.42);
// Separate seeded RNG for the (reproducible) bootstrap 95% CI of the p95 query time.
const bootstrapRng = mulberry32(12345);

const TABLE = "indexing_transactions";

const workspaceRoot = process.cwd();
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const rawDir = resolve(workspaceRoot, "results", "raw", `postgres-indexing-${timestamp}`);
const processedDir = resolve(workspaceRoot, "results", "processed");
const chartsDir = resolve(workspaceRoot, "results", "charts");
const reportPath = resolve(workspaceRoot, "docs", "postgres-indexing-report.md");

const STRATEGIES: Strategy[] = [
  {
    id: "I0",
    label: "No index",
    description: "Baseline — no secondary index",
    indexes: []
  },
  {
    id: "I1",
    label: "user_id",
    description: "Single column on user_id",
    indexes: [`CREATE INDEX ix_user ON ${TABLE} (user_id)`]
  },
  {
    id: "I2",
    label: "created_at",
    description: "Single column on created_at",
    indexes: [`CREATE INDEX ix_created ON ${TABLE} (created_at)`]
  },
  {
    id: "I3",
    label: "user_id, created_at DESC",
    description: "Composite for user history",
    indexes: [`CREATE INDEX ix_user_created ON ${TABLE} (user_id, created_at DESC)`]
  },
  {
    id: "I4",
    label: "status, created_at",
    description: "Composite for status + time range",
    indexes: [`CREATE INDEX ix_status_created ON ${TABLE} (status, created_at)`]
  },
  {
    id: "I5",
    label: "partial WHERE status='failed'",
    description: "Partial index on failed transactions",
    indexes: [
      `CREATE INDEX ix_failed_partial ON ${TABLE} (user_id, created_at DESC) WHERE status = 'failed'`
    ]
  },
  {
    id: "I6",
    label: "user_id, status, created_at DESC",
    description: "Composite covering user + status + time",
    indexes: [
      `CREATE INDEX ix_user_status_created ON ${TABLE} (user_id, status, created_at DESC)`
    ]
  }
];

const QUERIES: Query[] = [
  {
    id: "Q1",
    description: "User transaction history (user_id, ORDER BY created_at DESC LIMIT 50)",
    sql: `SELECT * FROM ${TABLE} WHERE user_id = 'user-1' ORDER BY created_at DESC LIMIT 50`
  },
  {
    id: "Q2",
    description: "Status + time range (status='failed')",
    sql: `SELECT * FROM ${TABLE} WHERE status = 'failed' AND created_at BETWEEN now() - interval '200 days' AND now() - interval '100 days'`
  },
  {
    id: "Q3",
    description: "High-value transactions (amount > 900 AND recent)",
    sql: `SELECT * FROM ${TABLE} WHERE amount > 900 AND created_at > now() - interval '180 days'`
  },
  {
    id: "Q4",
    description: "User + status + time range",
    sql: `SELECT * FROM ${TABLE} WHERE user_id = 'user-1' AND status = 'approved' AND created_at BETWEEN now() - interval '300 days' AND now()`
  },
  {
    id: "Q5",
    description: "Aggregate per user over a time window",
    sql: `SELECT user_id, count(*), sum(amount) FROM ${TABLE} WHERE created_at BETWEEN now() - interval '200 days' AND now() - interval '100 days' GROUP BY user_id ORDER BY sum(amount) DESC LIMIT 100`
  }
];

async function main(): Promise<void> {
  await mkdir(rawDir, { recursive: true });
  await mkdir(processedDir, { recursive: true });
  await mkdir(chartsDir, { recursive: true });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureDataset(client);

    const tableSizeBytes = await relationSize(client, TABLE);
    const queryResults: QueryResult[] = [];
    const strategyResults: StrategyResult[] = [];

    for (const strategy of STRATEGIES) {
      await applyStrategy(client, strategy);
      console.log(`Strategy ${strategy.id} (${strategy.label})`);

      strategyResults.push({
        strategy,
        indexSizeBytes: await strategyIndexSize(client, strategy),
        writeLatencyMs: await measureWriteLatency(client)
      });

      for (const query of QUERIES) {
        queryResults.push(await measureQuery(client, strategy, query));
      }
    }

    await writeRaw(client);
    await writeProcessedCsv(queryResults, strategyResults, tableSizeBytes);
    const charts = await writeCharts(queryResults, strategyResults);
    await writeReport(queryResults, strategyResults, tableSizeBytes, charts);

    console.log(`\nRaw plans: ${rawDir}`);
    console.log(`Processed CSV: ${resolve(processedDir, "postgres-indexing.csv")}`);
    console.log(`Charts: ${charts.join(", ")}`);
    console.log(`Report: ${reportPath}`);
  } finally {
    await client.end();
  }
}

async function ensureDataset(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      amount numeric(12, 2) NOT NULL,
      currency char(3) NOT NULL,
      status text NOT NULL,
      type text NOT NULL,
      created_at timestamptz NOT NULL
    )
  `);
  await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");

  const { rows } = await client.query<{ count: string }>(`SELECT count(*) FROM ${TABLE}`);
  const existing = Number(rows[0].count);

  if (existing === transactionCount) {
    console.log(`Dataset already seeded with ${existing} rows.`);
    return;
  }

  console.log(`Seeding ${transactionCount} rows (${userCount} users)...`);
  await client.query(`TRUNCATE ${TABLE}`);
  await client.query("SELECT setseed($1)", [seed]);
  await client.query(seedSql(transactionCount));
  await client.query(`ANALYZE ${TABLE}`);
  console.log("Seed complete.");
}

function seedSql(count: number): string {
  // One random() per column, computed once per row in the subquery.
  return `
    INSERT INTO ${TABLE} (user_id, amount, currency, status, type, created_at)
    SELECT
      'user-' || (1 + floor(r.ru * ${userCount}))::int,
      round((r.ra * 1000)::numeric, 2),
      'USD',
      CASE
        WHEN r.rs < 0.10 THEN 'failed'
        WHEN r.rs < 0.30 THEN 'pending'
        WHEN r.rs < 0.60 THEN 'declined'
        ELSE 'approved'
      END,
      (ARRAY['transfer', 'payment', 'deposit'])[1 + floor(r.rt * 3)::int],
      now() - (r.rc * interval '365 days')
    FROM (
      SELECT random() ru, random() ra, random() rs, random() rt, random() rc
      FROM generate_series(1, ${count})
    ) r
  `;
}

async function applyStrategy(client: Client, strategy: Strategy): Promise<void> {
  const { rows } = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE tablename = $1 AND indexname LIKE 'ix_%'`,
    [TABLE]
  );

  for (const row of rows) {
    await client.query(`DROP INDEX IF EXISTS ${row.indexname}`);
  }

  for (const statement of strategy.indexes) {
    await client.query(statement);
  }

  await client.query(`ANALYZE ${TABLE}`);
}

async function measureQuery(
  client: Client,
  strategy: Strategy,
  query: Query
): Promise<QueryResult> {
  const times: number[] = [];
  let lastPlan: PlanNode | undefined;
  let planningRows = 0;

  for (let rep = 0; rep < reps; rep += 1) {
    const plan = await explainAnalyze(client, query.sql);
    times.push(plan.executionTimeMs);
    lastPlan = plan.root;
    planningRows = plan.root["Plan Rows"] ?? 0;
  }

  const scan = scanInfo(lastPlan as PlanNode);
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
    planRows: planningRows,
    actualRows: (lastPlan as PlanNode)["Actual Rows"] ?? 0,
    scan
  };
}

type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Plan Rows"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  Plans?: PlanNode[];
};

async function explainAnalyze(
  client: Client,
  sql: string
): Promise<{ root: PlanNode; executionTimeMs: number }> {
  const { rows } = await client.query<{ "QUERY PLAN": Array<Record<string, unknown>> }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`
  );
  const payload = rows[0]["QUERY PLAN"][0];

  return {
    root: payload.Plan as PlanNode,
    executionTimeMs: Number(payload["Execution Time"] ?? 0)
  };
}

function scanInfo(root: PlanNode): ScanInfo {
  const node = findTableScan(root);

  if (!node) {
    return {
      nodeType: root["Node Type"],
      indexName: null,
      actualRows: 0,
      rowsScanned: 0
    };
  }

  // EXPLAIN reports per-loop averages; under a parallel scan "Actual Loops" equals
  // the worker count, so the true total is rows x loops. Without this, parallel
  // seq scans understate rows examined (e.g. 1/3 of the table with 3 workers).
  const loops = node["Actual Loops"] ?? 1;
  const actualRows = (node["Actual Rows"] ?? 0) * loops;
  const removed = (node["Rows Removed by Filter"] ?? 0) * loops;

  return {
    nodeType: node["Node Type"],
    // For a Bitmap Heap Scan the index name lives on the child Bitmap Index Scan.
    indexName: node["Index Name"] ?? findIndexName(node),
    actualRows,
    rowsScanned: actualRows + removed
  };
}

function findTableScan(node: PlanNode): PlanNode | undefined {
  if (node["Relation Name"] === TABLE) {
    return node;
  }

  for (const child of node.Plans ?? []) {
    const found = findTableScan(child);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function findIndexName(node: PlanNode): string | null {
  if (node["Index Name"]) {
    return node["Index Name"];
  }

  for (const child of node.Plans ?? []) {
    const found = findIndexName(child);
    if (found) {
      return found;
    }
  }

  return null;
}

async function measureWriteLatency(client: Client): Promise<number> {
  // Warm-up insert (discarded) so the first measured strategy is not penalised by
  // a cold cache/connection, which otherwise inverts the write-penalty ordering.
  await client.query("BEGIN");
  await client.query(seedSql(writeBatch));
  await client.query("ROLLBACK");

  const samples: number[] = [];
  for (let rep = 0; rep < writeReps; rep += 1) {
    await client.query("BEGIN");
    const startedAt = process.hrtime.bigint();
    await client.query(seedSql(writeBatch));
    samples.push(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
    await client.query("ROLLBACK");
  }

  return mean(samples);
}

async function strategyIndexSize(client: Client, strategy: Strategy): Promise<number> {
  if (strategy.indexes.length === 0) {
    return 0;
  }

  const { rows } = await client.query<{ total: string }>(
    `SELECT coalesce(sum(pg_relation_size(indexrelid)), 0) AS total
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname LIKE 'ix_%'`
  );

  return Number(rows[0].total);
}

async function relationSize(client: Client, relation: string): Promise<number> {
  const { rows } = await client.query<{ size: string }>(
    "SELECT pg_relation_size($1) AS size",
    [relation]
  );
  return Number(rows[0].size);
}

async function writeRaw(client: Client): Promise<void> {
  await writeFile(
    resolve(rawDir, "meta.json"),
    `${JSON.stringify(
      {
        databaseUrl: databaseUrl.replace(/:\/\/[^@]+@/, "://***@"),
        transactionCount,
        userCount,
        reps,
        writeBatch,
        writeReps,
        seed,
        strategies: STRATEGIES.map((s) => ({ id: s.id, indexes: s.indexes })),
        queries: QUERIES.map((q) => ({ id: q.id, sql: q.sql }))
      },
      null,
      2
    )}\n`
  );

  // Capture a fresh plan text per combination by re-applying each strategy once.
  for (const strategy of STRATEGIES) {
    await applyStrategy(client, strategy);
    for (const query of QUERIES) {
      const { rows } = await client.query<{ "QUERY PLAN": string }>(
        `EXPLAIN (ANALYZE, BUFFERS) ${query.sql}`
      );
      const text = rows.map((row) => row["QUERY PLAN"]).join("\n");
      await writeFile(
        resolve(rawDir, `explain-${strategy.id}-${query.id}.txt`),
        `${text}\n`
      );
    }
  }
}

async function writeProcessedCsv(
  results: QueryResult[],
  strategyResults: StrategyResult[],
  tableSizeBytes: number
): Promise<void> {
  const baseline = new Map<string, QueryResult>();
  for (const result of results) {
    if (result.strategy.id === "I0") {
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
    "rows_scanned",
    "rows_returned",
    "read_improvement_pct_vs_i0",
    "index_size_bytes",
    "table_size_bytes",
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
      csv(result.scan.nodeType),
      result.scan.indexName ?? "none",
      result.scan.rowsScanned,
      result.actualRows,
      round(improvement, 2),
      strategyEntry?.indexSizeBytes ?? 0,
      tableSizeBytes,
      round(strategyEntry?.writeLatencyMs ?? 0, 3)
    ].join(",");
  });

  await writeFile(
    resolve(processedDir, "postgres-indexing.csv"),
    `${[header, ...rows].join("\n")}\n`
  );
}

async function writeCharts(
  results: QueryResult[],
  strategyResults: StrategyResult[]
): Promise<string[]> {
  const strategyLabels = STRATEGIES.map((strategy) => strategy.id);
  const colors = [
    "#9aa7b5",
    "#4e79a7",
    "#f28e2b",
    "#59a14f",
    "#e15759",
    "#af7aa1",
    "#76b7b2"
  ];

  const lookup = (queryId: string, strategyId: string): number => {
    const found = results.find(
      (result) => result.query.id === queryId && result.strategy.id === strategyId
    );
    return found ? found.execP95Ms : 0;
  };

  const charts: Array<{ file: string; svg: string }> = [
    {
      file: "indexing-query-p95.svg",
      svg: renderBarChart({
        title: "Query Execution p95 by Index Strategy",
        subtitle: "EXPLAIN ANALYZE execution time, lower is better",
        categories: QUERIES.map((query) => query.id),
        yAxisLabel: "ms",
        format: (value) => value.toFixed(1),
        series: STRATEGIES.map((strategy, index) => ({
          name: strategy.id,
          color: colors[index % colors.length],
          values: QUERIES.map((query) => lookup(query.id, strategy.id))
        }))
      })
    },
    {
      file: "indexing-q1-user-history.svg",
      svg: renderBarChart({
        title: "Q1 User-History p95 by Index Strategy",
        subtitle: "WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
        categories: strategyLabels,
        yAxisLabel: "ms",
        format: (value) => value.toFixed(2),
        series: [
          {
            name: "Q1 p95 (ms)",
            color: "#4e79a7",
            values: STRATEGIES.map((strategy) => lookup("Q1", strategy.id))
          }
        ]
      })
    },
    {
      file: "indexing-write-penalty.svg",
      svg: renderBarChart({
        title: "Write Latency by Index Strategy",
        subtitle: `Time to insert ${writeBatch} rows (index maintenance), lower is better`,
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
      file: "indexing-index-size.svg",
      svg: renderBarChart({
        title: "Index Size by Strategy",
        subtitle: "On-disk size of the secondary index(es)",
        categories: strategyLabels,
        yAxisLabel: "MiB",
        format: (value) => value.toFixed(1),
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
  tableSizeBytes: number,
  charts: string[]
): Promise<void> {
  const baselineWrite =
    strategyResults.find((entry) => entry.strategy.id === "I0")?.writeLatencyMs ?? 0;
  const lines: string[] = [];

  lines.push("# PostgreSQL Indexing Report");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push(
    `This experiment measures how index strategies affect query execution time and ` +
      `write cost on a controlled dataset of ${transactionCount.toLocaleString()} ` +
      `transactions across ${userCount.toLocaleString()} users. For every ` +
      `strategy × query combination it captures a real \`EXPLAIN (ANALYZE, BUFFERS)\` ` +
      `plan and execution-time percentiles over ${reps} runs, with a bootstrap 95% ` +
      `confidence interval on the p95. Read improvement and write penalty are reported ` +
      `separately.`
  );
  lines.push("");
  lines.push(`- Index strategies: ${STRATEGIES.length}`);
  lines.push(`- Query patterns: ${QUERIES.length}`);
  lines.push(`- Combinations: ${STRATEGIES.length * QUERIES.length}`);
  lines.push(`- Repetitions per combination: ${reps}`);
  lines.push(`- Table size: ${(tableSizeBytes / 1024 ** 2).toFixed(1)} MiB`);
  lines.push("");

  lines.push("## Index Strategies");
  lines.push("");
  lines.push(
    "| Strategy | Index | Index size (MiB) | Write latency (ms) | Write penalty vs I0 |"
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
      "| Strategy | p95 [95% CI] (ms) | scan type | index used | rows scanned | improvement vs I0 |"
    );
    lines.push("| --- | --- | --- | --- | ---: | ---: |");
    const baseline = results.find(
      (result) => result.query.id === query.id && result.strategy.id === "I0"
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
      lines.push(
        `| ${strategy.id} | ${result.execP95Ms.toFixed(2)} [${result.execP95CiLo.toFixed(2)}, ${result.execP95CiHi.toFixed(2)}] | ${result.scan.nodeType} | ` +
          `${result.scan.indexName ?? "none"} | ${result.scan.rowsScanned.toLocaleString()} | ` +
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
    "- Execution times are server-side `EXPLAIN ANALYZE` measurements on a single " +
      "warm instance; absolute values depend on hardware, cache state, and dataset size."
  );
  lines.push(
    "- The dataset is synthetic with a uniform user distribution (~" +
      Math.round(transactionCount / userCount) +
      " rows/user); skewed real-world distributions change index selectivity."
  );
  lines.push(
    "- Write latency is measured as a rolled-back batch insert, which captures index " +
      "maintenance cost but not autovacuum or long-term bloat."
  );
  lines.push(
    "- This measures query execution time directly. End-to-end HTTP endpoint latency " +
      "under k6 load is a separate dimension and a documented future extension."
  );
  lines.push("");

  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push(
    "# Requires a reachable PostgreSQL (INDEXING_DATABASE_URL, default port 15499)"
  );
  lines.push("pnpm indexing:run");
  lines.push("```");
  lines.push("");
  lines.push(
    "Raw `EXPLAIN (ANALYZE, BUFFERS)` plans for every combination are stored under " +
      "`results/raw/postgres-indexing-<timestamp>/`."
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
      (result) => result.query.id === query.id && result.strategy.id === "I0"
    );
    const candidates = results.filter(
      (result) => result.query.id === query.id && result.strategy.id !== "I0"
    );
    if (!baseline || candidates.length === 0) {
      continue;
    }
    const best = candidates.reduce((a, b) => (a.execP95Ms <= b.execP95Ms ? a : b));
    const improvement =
      baseline.execP95Ms > 0
        ? ((baseline.execP95Ms - best.execP95Ms) / baseline.execP95Ms) * 100
        : 0;
    findings.push(
      `${query.id}: best strategy ${best.strategy.id} (${best.scan.nodeType}) cut p95 ` +
        `from ${baseline.execP95Ms.toFixed(2)} ms (${baseline.scan.nodeType}) to ` +
        `${best.execP95Ms.toFixed(2)} ms — ${signed(improvement)}.`
    );
  }

  const heaviestWrite = strategyResults
    .filter((entry) => entry.strategy.id !== "I0")
    .reduce((a, b) => (a.writeLatencyMs >= b.writeLatencyMs ? a : b));
  if (baselineWrite > 0) {
    findings.push(
      `Write penalty: every index slows inserts; the heaviest, ${heaviestWrite.strategy.id}, ` +
        `added ${signed(((heaviestWrite.writeLatencyMs - baselineWrite) / baselineWrite) * 100)} ` +
        `write latency vs the no-index baseline.`
    );
  }

  findings.push(
    "Partial index I5 only serves queries whose predicate matches `status = 'failed'`; " +
      "it is small and ignored by queries on other statuses — a deliberate narrow-index trade-off."
  );

  return findings;
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
