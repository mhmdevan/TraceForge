# MongoDB Indexing Report

Generated at: 2026-06-05T15:41:02.133Z

## Overview

This experiment measures how MongoDB index strategies affect query latency and write cost on a 1,000,000-document collection across 100,000 users — the NoSQL counterpart to the PostgreSQL indexing experiment. For every strategy × query it captures a real `explain("executionStats")` plan plus client-side latency percentiles over 15 runs.

- Index strategies: 6
- Query patterns: 4
- Combinations: 24
- Repetitions per combination: 15

## Index Strategies

| Strategy | Index | Index size (MiB) | Write latency (ms) | Write penalty vs M0 |
| --- | --- | ---: | ---: | ---: |
| M0 | Baseline — no secondary index | 0.00 | 11.7 | +0.0% |
| M1 | Single field on userId | 10.95 | 29.9 | +155.3% |
| M2 | Single field on createdAt | 11.24 | 35.3 | +201.6% |
| M3 | Compound for user history | 19.90 | 28.3 | +141.8% |
| M4 | Compound for status + time range | 11.42 | 32.9 | +181.1% |
| M5 | Compound covering user + status + time | 17.35 | 33.2 | +183.6% |

## Query Patterns

| Query | Description |
| --- | --- |
| Q1 | User transaction history (userId, sort createdAt desc, limit 50) |
| Q2 | Status + time range (status='failed') |
| Q3 | High-value transactions (amount > 900 AND recent) |
| Q4 | User + status + time range |

## Read Performance by Query

### Q1 — User transaction history (userId, sort createdAt desc, limit 50)

| Strategy | p95 [95% CI] (ms) | stage | index used | docs examined | improvement vs M0 |
| --- | --- | --- | --- | ---: | ---: |
| M0 | 258.290 [144.149, 258.290] | COLLSCAN+SORT | none | 1,000,000 | +0.0% |
| M1 | 3.825 [0.784, 3.825] | IXSCAN+SORT | userId_1 | 11 | +98.5% |
| M2 | 1919.955 [1441.473, 1919.955] | IXSCAN | createdAt_1 | 1,000,000 | -643.3% |
| M3 | 2.916 [1.512, 2.916] | IXSCAN | userId_1_createdAt_-1 | 11 | +98.9% |
| M4 | 324.011 [189.198, 324.011] | COLLSCAN+SORT | none | 1,000,000 | -25.4% |
| M5 | 2.544 [1.033, 2.544] | IXSCAN+SORT | userId_1_status_1_createdAt_-1 | 11 | +99.0% |

### Q2 — Status + time range (status='failed')

| Strategy | p95 [95% CI] (ms) | stage | index used | docs examined | improvement vs M0 |
| --- | --- | --- | --- | ---: | ---: |
| M0 | 545.277 [431.951, 545.277] | COLLSCAN | none | 1,000,000 | +0.0% |
| M1 | 593.820 [436.831, 593.820] | COLLSCAN | none | 1,000,000 | -8.9% |
| M2 | 1558.996 [983.944, 1558.996] | IXSCAN | createdAt_1 | 274,481 | -185.9% |
| M3 | 809.285 [599.243, 809.285] | COLLSCAN | none | 1,000,000 | -48.4% |
| M4 | 528.100 [396.790, 528.100] | IXSCAN | status_1_createdAt_1 | 27,553 | +3.2% |
| M5 | 722.242 [625.928, 722.242] | COLLSCAN | none | 1,000,000 | -32.5% |

### Q3 — High-value transactions (amount > 900 AND recent)

| Strategy | p95 [95% CI] (ms) | stage | index used | docs examined | improvement vs M0 |
| --- | --- | --- | --- | ---: | ---: |
| M0 | 989.679 [600.326, 989.679] | COLLSCAN | none | 1,000,000 | +0.0% |
| M1 | 696.954 [583.355, 696.954] | COLLSCAN | none | 1,000,000 | +29.6% |
| M2 | 3360.723 [1453.197, 3360.723] | IXSCAN | createdAt_1 | 493,229 | -239.6% |
| M3 | 1413.820 [986.364, 1413.820] | COLLSCAN | none | 1,000,000 | -42.9% |
| M4 | 1174.709 [846.079, 1174.709] | COLLSCAN | none | 1,000,000 | -18.7% |
| M5 | 1334.515 [1091.820, 1334.515] | COLLSCAN | none | 1,000,000 | -34.8% |

### Q4 — User + status + time range

| Strategy | p95 [95% CI] (ms) | stage | index used | docs examined | improvement vs M0 |
| --- | --- | --- | --- | ---: | ---: |
| M0 | 188.845 [177.824, 188.845] | COLLSCAN | none | 1,000,000 | +0.0% |
| M1 | 1.900 [0.841, 1.900] | IXSCAN | userId_1 | 11 | +99.0% |
| M2 | 1464.288 [1264.949, 1464.288] | IXSCAN | createdAt_1 | 821,173 | -675.4% |
| M3 | 3.581 [0.811, 3.581] | IXSCAN | userId_1_createdAt_-1 | 10 | +98.1% |
| M4 | 511.473 [436.817, 511.473] | IXSCAN | status_1_createdAt_1 | 328,831 | -170.8% |
| M5 | 2.675 [1.080, 2.675] | IXSCAN | userId_1_status_1_createdAt_-1 | 4 | +98.6% |

## Charts

![mongo-query-p95.svg](../results/charts/mongo-query-p95.svg)

![mongo-docs-examined.svg](../results/charts/mongo-docs-examined.svg)

![mongo-write-penalty.svg](../results/charts/mongo-write-penalty.svg)

![mongo-index-size.svg](../results/charts/mongo-index-size.svg)

## Findings

- Q1: best strategy M1 (IXSCAN) examined 11 docs vs 1,000,000 for the no-index COLLSCAN.
- Q2: best strategy M4 (IXSCAN) examined 27,553 docs vs 1,000,000 for the no-index COLLSCAN.
- Q3: best strategy M2 (IXSCAN) examined 493,229 docs vs 1,000,000 for the no-index COLLSCAN.
- Q4: best strategy M5 (IXSCAN) examined 4 docs vs 1,000,000 for the no-index COLLSCAN.
- Write penalty: the heaviest index, M2, added +201.6% insert latency vs the no-index baseline.

## Threats to Validity

- Latency is client-side wall-clock against a local container, so it includes driver and loopback round-trip; `explain()` documents-examined and stage are the cleaner structural signal and are emphasised in the comparison.
- The dataset is synthetic with a uniform user distribution (~10 docs/user); skewed real-world data changes index selectivity.
- Write latency is a batch insert measured then deleted; it captures index maintenance, not background compaction or long-term storage growth.
- Results are tied to the WiredTiger storage engine and the pinned MongoDB image.

## Reproduce

```bash
# Requires a reachable MongoDB (MONGO_URL, default port 27117)
pnpm indexing:mongo
```

Raw `explain("executionStats")` plans for every combination are stored under `results/raw/mongo-indexing-<timestamp>/`. See `docs/sql-nosql-comparison.md` for the careful PostgreSQL-vs-MongoDB comparison.
