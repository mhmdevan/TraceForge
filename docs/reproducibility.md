# Reproducibility

This document is the reproduction guide and replication-package description for the
TraceForge study. Every figure, table, and processed dataset in the repository is
regenerable from source with the commands below.

## 1. Recorded environment

The exact environment each experiment ran on is captured (machine-readable) in
[`results/environment.json`](../results/environment.json) via `pnpm env:capture`. The
reference runs in this repository were produced on:

| Component | Value                          |
| --------- | ------------------------------ |
| OS        | macOS (Darwin 25.3.0), `arm64` |
| CPU       | Apple M4, 10 logical cores     |
| Memory    | 16 GiB                         |
| Node.js   | v20.19.0                       |
| pnpm      | 10.26.1                        |
| Docker    | 20.10.16 (Compose v2.6.0)      |

`results/environment.json` also records the **image digests** of every pinned
container (PostgreSQL, MongoDB, Redis, RabbitMQ, Prometheus, Grafana, Loki, Jaeger,
the OpenTelemetry Collector, and k6), so a re-runner can match exact image versions.

> Absolute timings depend on this hardware; relative results and structural metrics
> (rows/documents examined, scan types, detection step-change) are hardware-robust.

## 2. Prerequisites

- **Docker** (Desktop or Engine) with Compose v2 — required for every live experiment.
- **Node.js 20+** and **pnpm 10+**.
- No local k6 or PostgreSQL/MongoDB client is needed: the harnesses run k6 and `psql`
  inside containers.
- Optional: `kubectl` / `kubeconform` to validate the Kubernetes manifests.

## 3. Setup and static verification

```bash
pnpm install
pnpm typecheck      # strict TypeScript across all packages and apps
pnpm lint           # eslint
pnpm format:check   # prettier
pnpm test           # 52 unit tests (incl. statistics numerics) + 1 skipped e2e
pnpm build          # build all packages and apps
pnpm env:capture    # record this machine's environment -> results/environment.json
```

## 4. Reproducing each result

All commands are run from the repository root. Live experiments bring their own stack
up and tear it down.

| Result                                        | Command                                                                                                                | Outputs                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| End-to-end flow (live stack)                  | bring up base stack, then `RUN_E2E=true pnpm test:e2e`                                                                 | passing e2e test                                                       |
| Observability overhead (per mode)             | `pnpm baseline:run`, `pnpm metrics:run`, `pnpm metrics-logs:run`, `pnpm metrics-logs-traces:run`, `pnpm otel-full:run` | `results/processed/<mode>-summary.csv`, `docs/<mode>*.md`              |
| Cross-mode overhead aggregation               | `pnpm overhead:report`                                                                                                 | `docs/observability-overhead-report.md`, 6 charts                      |
| **Statistical analysis**                      | `pnpm stats:report`                                                                                                    | `docs/statistics-report.md`, `statistics.csv/json`, box plots          |
| **Realistic load harness** (N≥10, open model) | `pnpm load:run` then `STATS_DATASET=load pnpm stats:report`                                                            | `results/processed/load-*.csv`, `docs/statistics-load-report.md`       |
| **Latency–throughput sweep**                  | `pnpm sweep:run`                                                                                                       | `results/processed/sweep-*.csv`, `docs/load-sweep-report.md`, 2 charts |
| **PostgreSQL indexing** (1M rows)             | start Postgres (below), then `INDEXING_TRANSACTIONS=1000000 INDEXING_USERS=100000 INDEXING_REPS=15 pnpm indexing:run`  | `docs/postgres-indexing-report.md`, `postgres-indexing.csv`, raw plans |
| **MongoDB indexing** (1M docs)                | start Mongo (below), then `INDEXING_TRANSACTIONS=1000000 INDEXING_USERS=100000 INDEXING_REPS=15 pnpm indexing:mongo`   | `docs/mongodb-indexing-report.md`, `mongodb-indexing.csv`              |
| SQL-vs-NoSQL comparison                       | `pnpm sql-nosql:report`                                                                                                | `docs/sql-nosql-comparison.md`, 2 charts                               |
| Orchestration (Compose vs Swarm)              | `pnpm orchestration:run`                                                                                               | `docs/orchestration-comparison.md`, 3 charts                           |
| **Objective MTTD** (RQ2 detection)            | `pnpm mttd:run`                                                                                                        | `docs/mttd-report.md`, `mttd-results.csv`, chart                       |
| Failure-injection root-cause (manual)         | follow `docs/failure-injection-protocol.md`, then `pnpm failure:report`                                                | `docs/failure-injection-report.md`                                     |

Throwaway databases for the indexing experiments:

```bash
docker run -d --name tf-pg   -e POSTGRES_DB=traceforge_indexing -e POSTGRES_USER=traceforge \
  -e POSTGRES_PASSWORD=traceforge -p 15499:5432 postgres:16-alpine
docker run -d --name tf-mongo -p 27117:27017 mongo:7
# ... run the indexing experiments ...
docker rm -f tf-pg tf-mongo
```

## 5. Determinism

| Aspect                                                                         | Deterministic?                                                                                                                                  |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Statistical analysis (bootstrap CIs, tests)                                    | **Yes** — seeded RNG (`SEED`), identical inputs → identical outputs                                                                             |
| Index dataset generation                                                       | **Yes** — PostgreSQL `setseed` / Mongo seeded PRNG (`INDEXING_SEED`)                                                                            |
| Load-harness mode order                                                        | **Yes** — seeded shuffle (`LOAD_SEED`)                                                                                                          |
| Structural metrics (rows/docs examined, scan type, alert pending/firing logic) | **Yes**                                                                                                                                         |
| Wall-clock latency, CPU/memory, exact alert-firing second                      | **No** — these depend on hardware and load and vary run-to-run; this is why they are reported with confidence intervals and repeated N≥10 times |

## 6. Artifact map

```text
results/
  environment.json     # captured hardware/software + image digests
  raw/                  # per-run k6 summaries, Docker stats, EXPLAIN plans, alert snapshots
  processed/            # comparison CSV/JSON (overhead, statistics, indexing, mttd, ...)
  charts/               # all dependency-free SVG figures
docs/
  final-report.md       # full write-up   ·  paper-draft.md  # condensed skeleton
  related-work.md       # literature review
  *-report.md / *-comparison.md / statistics*.md / mttd-report.md   # generated analyses
```

## 7. Known caveats

- **Always run current code.** Container images are tagged `:latest`; the experiment
  runners that depend on application behaviour (`load:run`, `mttd:run`) **rebuild
  images first**. If you bring the stack up manually, pass `--build`, or a stale image
  may silently ignore configuration (e.g. fault flags).
- **Single machine, point-in-time.** Absolute numbers reflect the recorded environment.
- **Docker Desktop port leaks.** The harnesses publish **ephemeral host ports** and run
  k6/`psql`/alert polling **in-network** to avoid leaked-binding conflicts across the
  many up/down cycles.
- **Early overhead data is a micro-benchmark** (few VUs, short runs); the realistic,
  statistically-powered campaign uses `pnpm load:run` (open-model, N≥10). See the
  threats-to-validity discussion in `final-report.md`.

## 8. Data-availability statement

The complete source code, experiment harnesses, raw and processed data, and all
figures supporting this study are available in this repository. Code is licensed under
the MIT License; experimental data and figures (the contents of `results/` and the
generated reports) are licensed under CC-BY-4.0. An archived, versioned snapshot is
available on Zenodo: [10.5281/zenodo.20561281](https://doi.org/10.5281/zenodo.20561281).
Every result is regenerable from source with the commands in §4.

## 9. Citing and archiving

- **Cite** the software using [`CITATION.cff`](../CITATION.cff) (GitHub renders a
  "Cite this repository" button).
- **Archived snapshot:** [10.5281/zenodo.20561281](https://doi.org/10.5281/zenodo.20561281)
  (minted via the GitHub–Zenodo integration from a tagged release; Zenodo reads
  [`.zenodo.json`](../.zenodo.json) for metadata). New releases mint a new version DOI
  under the same concept DOI.
