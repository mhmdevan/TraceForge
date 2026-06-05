# PostgreSQL Indexing Report

Generated at: 2026-06-05T15:47:51.700Z

## Overview

This experiment measures how index strategies affect query execution time and write cost on a controlled dataset of 1,000,000 transactions across 100,000 users. For every strategy × query combination it captures a real `EXPLAIN (ANALYZE, BUFFERS)` plan and execution-time percentiles over 15 runs, with a bootstrap 95% confidence interval on the p95. Read improvement and write penalty are reported separately.

- Index strategies: 7
- Query patterns: 5
- Combinations: 35
- Repetitions per combination: 15
- Table size: 88.8 MiB

## Index Strategies

| Strategy | Index | Index size (MiB) | Write latency (ms) | Write penalty vs I0 |
| --- | --- | ---: | ---: | ---: |
| I0 | Baseline — no secondary index | 0.00 | 5.6 | +0.0% |
| I1 | Single column on user_id | 9.75 | 16.0 | +186.8% |
| I2 | Single column on created_at | 21.45 | 15.3 | +173.4% |
| I3 | Composite for user history | 38.74 | 13.8 | +147.1% |
| I4 | Composite for status + time range | 36.16 | 23.6 | +322.4% |
| I5 | Partial index on failed transactions | 3.90 | 6.7 | +19.1% |
| I6 | Composite covering user + status + time | 47.41 | 19.0 | +239.3% |

## Query Patterns

| Query | Description |
| --- | --- |
| Q1 | User transaction history (user_id, ORDER BY created_at DESC LIMIT 50) |
| Q2 | Status + time range (status='failed') |
| Q3 | High-value transactions (amount > 900 AND recent) |
| Q4 | User + status + time range |
| Q5 | Aggregate per user over a time window |

## Read Performance by Query

### Q1 — User transaction history (user_id, ORDER BY created_at DESC LIMIT 50)

| Strategy | p95 [95% CI] (ms) | scan type | index used | rows scanned | improvement vs I0 |
| --- | --- | --- | --- | ---: | ---: |
| I0 | 24.45 [17.59, 24.45] | Seq Scan | none | 999,999 | +0.0% |
| I1 | 0.11 [0.04, 0.11] | Bitmap Heap Scan | ix_user | 16 | +99.6% |
| I2 | 19.32 [18.28, 19.32] | Seq Scan | none | 999,999 | +21.0% |
| I3 | 0.08 [0.05, 0.08] | Bitmap Heap Scan | ix_user_created | 16 | +99.7% |
| I4 | 26.43 [20.23, 26.43] | Seq Scan | none | 999,999 | -8.1% |
| I5 | 16.24 [15.72, 16.24] | Seq Scan | none | 999,999 | +33.6% |
| I6 | 0.07 [0.03, 0.07] | Bitmap Heap Scan | ix_user_status_created | 16 | +99.7% |

### Q2 — Status + time range (status='failed')

| Strategy | p95 [95% CI] (ms) | scan type | index used | rows scanned | improvement vs I0 |
| --- | --- | --- | --- | ---: | ---: |
| I0 | 25.36 [24.24, 25.36] | Seq Scan | none | 1,000,002 | +0.0% |
| I1 | 124.39 [56.03, 124.39] | Seq Scan | none | 1,000,002 | -390.4% |
| I2 | 31.11 [27.40, 31.11] | Bitmap Heap Scan | ix_created | 273,549 | -22.6% |
| I3 | 59.52 [25.53, 59.52] | Seq Scan | none | 1,000,002 | -134.6% |
| I4 | 13.49 [11.24, 13.49] | Bitmap Heap Scan | ix_status_created | 27,740 | +46.8% |
| I5 | 11.10 [9.04, 11.10] | Bitmap Heap Scan | ix_failed_partial | 27,740 | +56.3% |
| I6 | 27.65 [25.60, 27.65] | Seq Scan | none | 1,000,002 | -9.0% |

### Q3 — High-value transactions (amount > 900 AND recent)

| Strategy | p95 [95% CI] (ms) | scan type | index used | rows scanned | improvement vs I0 |
| --- | --- | --- | --- | ---: | ---: |
| I0 | 33.06 [28.00, 33.06] | Seq Scan | none | 999,999 | +0.0% |
| I1 | 83.74 [58.42, 83.74] | Seq Scan | none | 999,999 | -153.3% |
| I2 | 29.96 [28.80, 29.96] | Seq Scan | none | 999,999 | +9.4% |
| I3 | 31.98 [28.86, 31.98] | Seq Scan | none | 999,999 | +3.2% |
| I4 | 30.15 [28.83, 30.15] | Seq Scan | none | 999,999 | +8.8% |
| I5 | 34.05 [28.29, 34.05] | Seq Scan | none | 999,999 | -3.0% |
| I6 | 36.05 [28.79, 36.05] | Seq Scan | none | 999,999 | -9.1% |

### Q4 — User + status + time range

| Strategy | p95 [95% CI] (ms) | scan type | index used | rows scanned | improvement vs I0 |
| --- | --- | --- | --- | ---: | ---: |
| I0 | 20.02 [19.39, 20.02] | Seq Scan | none | 1,000,002 | +0.0% |
| I1 | 0.31 [0.14, 0.31] | Bitmap Heap Scan | ix_user | 16 | +98.5% |
| I2 | 21.61 [20.23, 21.61] | Seq Scan | none | 1,000,002 | -7.9% |
| I3 | 0.06 [0.04, 0.06] | Bitmap Heap Scan | ix_user_created | 12 | +99.7% |
| I4 | 20.35 [19.22, 20.35] | Seq Scan | none | 1,000,002 | -1.7% |
| I5 | 25.08 [21.17, 25.08] | Seq Scan | none | 1,000,002 | -25.3% |
| I6 | 0.04 [0.02, 0.04] | Index Scan | ix_user_status_created | 5 | +99.8% |

### Q5 — Aggregate per user over a time window

| Strategy | p95 [95% CI] (ms) | scan type | index used | rows scanned | improvement vs I0 |
| --- | --- | --- | --- | ---: | ---: |
| I0 | 256.42 [246.13, 256.42] | Seq Scan | none | 1,000,000 | +0.0% |
| I1 | 286.51 [272.13, 286.51] | Seq Scan | none | 1,000,000 | -11.7% |
| I2 | 128.16 [124.92, 128.16] | Bitmap Heap Scan | ix_created | 273,548 | +50.0% |
| I3 | 270.48 [230.06, 270.48] | Seq Scan | none | 1,000,000 | -5.5% |
| I4 | 228.27 [216.13, 228.27] | Seq Scan | none | 1,000,000 | +11.0% |
| I5 | 258.81 [219.79, 258.81] | Seq Scan | none | 1,000,000 | -0.9% |
| I6 | 279.25 [223.94, 279.25] | Seq Scan | none | 1,000,000 | -8.9% |

## Charts

![indexing-query-p95.svg](../results/charts/indexing-query-p95.svg)

![indexing-q1-user-history.svg](../results/charts/indexing-q1-user-history.svg)

![indexing-write-penalty.svg](../results/charts/indexing-write-penalty.svg)

![indexing-index-size.svg](../results/charts/indexing-index-size.svg)

## Findings

- Q1: best strategy I6 (Bitmap Heap Scan) cut p95 from 24.45 ms (Seq Scan) to 0.07 ms — +99.7%.
- Q2: best strategy I5 (Bitmap Heap Scan) cut p95 from 25.36 ms (Seq Scan) to 11.10 ms — +56.3%.
- Q3: best strategy I2 (Seq Scan) cut p95 from 33.06 ms (Seq Scan) to 29.96 ms — +9.4%.
- Q4: best strategy I6 (Index Scan) cut p95 from 20.02 ms (Seq Scan) to 0.04 ms — +99.8%.
- Q5: best strategy I2 (Bitmap Heap Scan) cut p95 from 256.42 ms (Seq Scan) to 128.16 ms — +50.0%.
- Write penalty: every index slows inserts; the heaviest, I4, added +322.4% write latency vs the no-index baseline.
- Partial index I5 only serves queries whose predicate matches `status = 'failed'`; it is small and ignored by queries on other statuses — a deliberate narrow-index trade-off.

## Threats to Validity

- Execution times are server-side `EXPLAIN ANALYZE` measurements on a single warm instance; absolute values depend on hardware, cache state, and dataset size.
- The dataset is synthetic with a uniform user distribution (~10 rows/user); skewed real-world distributions change index selectivity.
- Write latency is measured as a rolled-back batch insert, which captures index maintenance cost but not autovacuum or long-term bloat.
- This measures query execution time directly. End-to-end HTTP endpoint latency under k6 load is a separate dimension and a documented future extension.

## Reproduce

```bash
# Requires a reachable PostgreSQL (INDEXING_DATABASE_URL, default port 15499)
pnpm indexing:run
```

Raw `EXPLAIN (ANALYZE, BUFFERS)` plans for every combination are stored under `results/raw/postgres-indexing-<timestamp>/`.
