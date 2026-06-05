# PostgreSQL vs MongoDB Indexing Comparison

Generated at: 2026-06-05T15:48:01.051Z

## Scope

This compares the PostgreSQL (Phase 10) and MongoDB (Phase 11) indexing experiments on equivalent query patterns and a comparable 100k-row/document dataset. It deliberately leads with the **structural** metric — rows/documents examined and scan type — which is directly comparable across engines. Latency is reported as **indicative only**: the two experiments use different timing methodologies (see Limitations), so absolute latency must not be read as one engine being faster than the other.

Only the four `find`-style patterns shared by both experiments are compared; the PostgreSQL Q5 aggregate has no equivalent in the MongoDB query set.

## Structural Comparison (rows / documents examined)

| Query | PG no-index | PG best (index) | examined | Mongo no-index | Mongo best (index) | examined |
| --- | --- | --- | ---: | --- | --- | ---: |
| Q1 | Seq Scan (999,999) | I6 Bitmap Heap Scan | 16 | COLLSCAN (1,000,000) | M5 IXSCAN | 11 |
| Q2 | Seq Scan (1,000,002) | I5 Bitmap Heap Scan | 27,740 | COLLSCAN (1,000,000) | M4 IXSCAN | 27,553 |
| Q3 | Seq Scan (999,999) | I2 Seq Scan | 999,999 | COLLSCAN (1,000,000) | M2 IXSCAN | 493,229 |
| Q4 | Seq Scan (1,000,002) | I6 Index Scan | 5 | COLLSCAN (1,000,000) | M5 IXSCAN | 4 |

## Indicative Latency (p95, different timing methodologies)

> PostgreSQL p95 is server-side `EXPLAIN ANALYZE` execution time; MongoDB p95 is client-side wall-clock. Compare within an engine, not across.

| Query | PG no-index p95 | PG best p95 | Mongo no-index p95 | Mongo best p95 |
| --- | ---: | ---: | ---: | ---: |
| Q1 | 24.45 ms | 0.07 ms | 258.29 ms | 2.54 ms |
| Q2 | 25.36 ms | 11.10 ms | 545.28 ms | 528.10 ms |
| Q3 | 33.06 ms | 29.96 ms | 989.68 ms | 3360.72 ms |
| Q4 | 20.02 ms | 0.04 ms | 188.84 ms | 2.67 ms |

## Charts

![sql-nosql-examined-baseline.svg](../results/charts/sql-nosql-examined-baseline.svg)

![sql-nosql-examined-best.svg](../results/charts/sql-nosql-examined-best.svg)

## Scoped Observations

- **Q1 (User transaction history)**: for this dataset and access pattern, PostgreSQL's best index (I6, Bitmap Heap Scan) examined 16 rows vs 999,999 for the sequential scan; MongoDB's best index (M5, IXSCAN) examined 11 documents vs 1,000,000 for the collection scan. Both engines reduced work along the same structural lines.
- **Q2 (Status + time range (status='failed'))**: for this dataset and access pattern, PostgreSQL's best index (I5, Bitmap Heap Scan) examined 27,740 rows vs 1,000,002 for the sequential scan; MongoDB's best index (M4, IXSCAN) examined 27,553 documents vs 1,000,000 for the collection scan. Both engines reduced work along the same structural lines.
- **Q3 (High-value transactions)**: for this dataset and access pattern, PostgreSQL's best index (I2, Seq Scan) examined 999,999 rows vs 999,999 for the sequential scan; MongoDB's best index (M2, IXSCAN) examined 493,229 documents vs 1,000,000 for the collection scan. Both engines reduced work along the same structural lines.
- **Q4 (User + status + time range)**: for this dataset and access pattern, PostgreSQL's best index (I6, Index Scan) examined 5 rows vs 1,000,002 for the sequential scan; MongoDB's best index (M5, IXSCAN) examined 4 documents vs 1,000,000 for the collection scan. Both engines reduced work along the same structural lines.

## Limitations

- **Timing methodology differs.** PostgreSQL latency is server-side `EXPLAIN ANALYZE` execution time (sub-millisecond resolution); MongoDB latency is client-side wall-clock including driver and loopback round-trip. Cross-engine latency numbers are therefore not directly comparable — the structural rows/documents-examined metric is the fair comparison.
- **Different engines and storage layers** (PostgreSQL heap + B-tree vs MongoDB WiredTiger), pinned image versions, and default configurations.
- **Synthetic, uniformly-distributed data** with the same generator logic on both sides; real-world skew would change selectivity and index value.
- **Same machine, single run per engine**; absolute numbers depend on hardware and cache state. Conclusions are scoped to this dataset, access pattern, index strategy, hardware, and load profile — not a general claim that one engine indexes better than the other.

## Reproduce

```bash
pnpm indexing:run     # PostgreSQL (Phase 10)
pnpm indexing:mongo   # MongoDB (Phase 11)
pnpm sql-nosql:report # this comparison
```
