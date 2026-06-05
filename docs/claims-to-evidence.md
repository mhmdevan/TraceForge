# Claims → Evidence

Every claim made in the README and manuscript maps to a generated report, a one-line
command that reproduces it, and the data file it is computed from. Numbers characterize
**this** artifact (see Research Scope in the README); they are not universal constants.

| #   | Claim                                                                                                              | Evidence (report)                  | Command to reproduce                                                                     | Result data                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Metrics-only overhead is **not statistically distinguishable** from baseline (CPU p≈0.34, p50 p≈0.31; CIs overlap) | `docs/statistics-load-report.md`   | `STATS_DATASET=load pnpm stats:report`                                                   | `results/processed/statistics-load.csv`, `load-metrics-summary.csv`      |
| 2   | **Structured logging is the dominant cost** (CPU +164%, p50 +177%, p<0.001, Cliff's δ=1.0)                         | `docs/statistics-load-report.md`   | `pnpm load:run` → `STATS_DATASET=load pnpm stats:report`                                 | `results/processed/load-metrics_logs-summary.csv`, `statistics-load.csv` |
| 3   | **Full OpenTelemetry has the least throughput headroom** — saturates ≈220 req/s vs baseline >480                   | `docs/load-sweep-report.md`        | `pnpm sweep:run`                                                                         | `results/processed/sweep-otel_full.csv`, `sweep-baseline.csv`            |
| 4   | Without a metrics pipeline a fault is **automatically undetectable**; with metrics, detected in ≈9–70 s (MTTD)     | `docs/mttd-report.md`              | `pnpm mttd:run`                                                                          | `results/processed/mttd-results.csv`                                     |
| 5   | Matching indexes turn **1M-row scans into ~16-row lookups**; write penalty +19%…+322%                              | `docs/postgres-indexing-report.md` | `INDEXING_TRANSACTIONS=1000000 INDEXING_USERS=100000 INDEXING_REPS=15 pnpm indexing:run` | `results/processed/postgres-indexing.csv`                                |
| 6   | SQL and NoSQL examine **comparable structural work** at 1M (e.g. 16 rows vs 11 documents)                          | `docs/sql-nosql-comparison.md`     | `pnpm indexing:mongo` then `pnpm sql-nosql:report`                                       | `results/processed/mongodb-indexing.csv`, `postgres-indexing.csv`        |
| 7   | Compose/Swarm/Kubernetes show the expected overhead-vs-capability trade-off                                        | `docs/orchestration-comparison.md` | `pnpm orchestration:run`                                                                 | `results/processed/orchestration-*.csv`                                  |
| 8   | The end-to-end transaction flow (HTTP → SQL → cache → payment → queue → worker) works                              | e2e test                           | bring up base stack, then `RUN_E2E=true pnpm test:e2e`                                   | test output                                                              |

Notes:

- **Raw data** for each live run is written under `results/raw/<experiment>-<timestamp>/`
  (k6 summaries, Docker stats, `EXPLAIN` plans, alert snapshots) alongside the processed
  CSVs above.
- **Determinism:** statistical analysis, dataset generation, and mode order are seeded; raw
  timings vary run-to-run, which is why they are reported with confidence intervals (see
  `docs/reproducibility.md`).
- **Environment** the reference runs were produced on is recorded in
  `results/environment.json`.
