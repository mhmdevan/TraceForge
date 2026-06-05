<div align="center">

# 🔭 TraceForge

### Observable Microservice Lab

**An experiment-first platform that _measures_ the real cost and debugging value of observability in a containerized microservice system.**

_Not another microservices demo — a controlled laboratory that produces repeatable measurements, comparison tables, and charts._

<br/>

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)
![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=nodedotjs&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-FF4438?logo=redis&logoColor=white)
![RabbitMQ](https://img.shields.io/badge/RabbitMQ-FF6600?logo=rabbitmq&logoColor=white)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-425CC7?logo=opentelemetry&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?logo=prometheus&logoColor=white)
![Grafana](https://img.shields.io/badge/Grafana-F46800?logo=grafana&logoColor=white)
![k6](https://img.shields.io/badge/k6-7D64FF?logo=k6&logoColor=white)

![Tests](https://img.shields.io/badge/tests-42%20passing-brightgreen)
![Strict](https://img.shields.io/badge/TypeScript-strict-blue)
![v1](https://img.shields.io/badge/v1-complete-success)
![report](https://img.shields.io/badge/final%20report-published-blueviolet)

</div>

---

## ✨ Why TraceForge?

Most "microservice projects" prove that an app _works_. TraceForge proves that a system can be **deployed, observed, measured, stressed, broken on purpose, and explained with evidence.**

It answers one core question with numbers, not opinions:

> **How much performance and resource overhead does observability add — and how much does it actually improve debugging and failure diagnosis?**

|                                 |                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 🎚️ **One switch, five depths**  | A single `OBS_MODE` variable flips the whole stack between _no observability_ and a _full OpenTelemetry pipeline_.           |
| 📏 **Measurement from day one** | Every mode runs the same k6 load, captures Docker stats + telemetry volume, and computes overhead vs a baseline.             |
| 💥 **Break it on purpose**      | Six injectable faults (slow payment, errors, slow DB, dead consumer, Redis down, memory pressure) for debuggability studies. |
| 📊 **Real artifacts**           | Repeatable CSVs, dependency-free SVG charts, and analysis reports — not screenshots.                                         |
| 🧱 **Clean architecture**       | pnpm monorepo, ports-and-adapters services, shared typed packages, strict TypeScript, CI.                                    |

---

## 🏗️ Architecture

```mermaid
flowchart LR
  k6([🧪 k6 / Client]) --> GW[API Gateway]
  GW --> TX[Transaction Service]
  TX --> PG[(🐘 PostgreSQL)]
  TX --> RD[(⚡ Redis)]
  TX --> PAY[Payment Service]
  TX --> MQ{{🐇 RabbitMQ}}
  MQ --> WK[Worker Service]
  WK --> PG

  subgraph OBS [🔭 Observability]
    OT[OTel Collector] --> PR[Prometheus]
    OT --> LO[Loki]
    OT --> JA[Jaeger]
    PR --> GR[📊 Grafana]
    LO --> GR
    JA --> GR
  end

  GW -. OTLP .-> OT
  TX -. OTLP .-> OT
  PAY -. OTLP .-> OT
  WK -. OTLP .-> OT
```

**The request path:** `POST /transactions` → API Gateway → Transaction Service → **PostgreSQL write → Redis cache → Payment Service → RabbitMQ publish → Worker consume → event persisted.** One flow that crosses HTTP, SQL, cache, and async messaging — enough surface area to measure something real.

| Service                | Package                           |   Port | Role                                      |
| ---------------------- | --------------------------------- | -----: | ----------------------------------------- |
| 🚪 API Gateway         | `@traceforge/api-gateway`         | `3000` | Public API, correlation/trace propagation |
| 💳 Transaction Service | `@traceforge/transaction-service` | `3001` | Core flow, Postgres + Redis + RabbitMQ    |
| 🏦 Payment Service     | `@traceforge/payment-service`     | `3002` | Simulated payment + fault injection       |
| ⚙️ Worker Service      | `@traceforge/worker-service`      | `3003` | Consumes events, persists them            |

---

## 🔭 Observability Modes

Flip the entire telemetry depth with one environment variable. Every layer cleanly degrades to a no-op when disabled.

| `OBS_MODE`            | Metrics | Logs | Traces | Collector | Purpose                                      |
| --------------------- | :-----: | :--: | :----: | :-------: | -------------------------------------------- |
| `none`                |   ⬜    |  ⬜  |   ⬜   |    ⬜     | Raw baseline                                 |
| `metrics`             |   ✅    |  ⬜  |   ⬜   |    ⬜     | Prometheus only                              |
| `metrics_logs`        |   ✅    |  ✅  |   ⬜   |    ⬜     | + structured logs & correlation IDs (Loki)   |
| `metrics_logs_traces` |   ✅    |  ✅  |   ✅   |    ⬜     | + distributed tracing (Jaeger)               |
| `otel_full`           |   ✅    |  ✅  |   ✅   |    ✅     | Everything routed through the OTel Collector |

---

## 🧪 What It Measures — Sample Findings

The overhead aggregator (`pnpm overhead:report`) compares all five modes across 15 runs and renders six charts. A real result from this repo:

| Mode              | p95 (ms) | p95 overhead | CPU overhead | Telemetry              |
| ----------------- | -------: | -----------: | -----------: | ---------------------- |
| 🟢 Baseline       |     12.9 |            — |            — | —                      |
| 📈 Metrics        |     10.8 |       −15.9% |       −19.8% | —                      |
| 📝 Metrics + Logs |     60.4 |  **+369.6%** |      +158.7% | ~56.9k logs / 10k req  |
| 🔗 + Traces       |     27.4 |      +113.0% |      +118.0% | ~66.7k spans / 10k req |
| 🛰️ Full OTel      |     68.5 |  **+432.6%** |      +143.8% | Collector ≈ 18% CPU    |

> 💡 **Takeaway:** at this load, metrics are nearly free (within noise), **logging is the dominant cost**, and the full pipeline trades the most overhead for the richest debuggability. Numbers are point-in-time and reported with explicit threats-to-validity.

📄 **Read the full write-up:** [`docs/final-report.md`](docs/final-report.md) — abstract, methodology, results, discussion, threats to validity, and reproducibility (condensed version in [`docs/paper-draft.md`](docs/paper-draft.md)).

---

## 💥 Failure Injection & Debuggability

Six faults, all **off by default**, toggled by environment variables — paired with a manual debugging protocol that measures _time-to-detect_ and _time-to-root-cause_ across observability modes.

| ID  | Scenario             | Inject with                                           | Symptom              | Best tool           |
| --- | -------------------- | ----------------------------------------------------- | -------------------- | ------------------- |
| F1  | 🐌 Slow payment      | `PAYMENT_MODE=slow PAYMENT_DELAY_MS=1000`             | high latency         | traces              |
| F2  | 🔴 Payment errors    | `PAYMENT_ERROR_RATE=0.2`                              | error spike          | metrics + logs      |
| F3  | 🐢 Slow DB query     | `DB_SLOW_QUERY=true`                                  | p95 increase         | traces + DB metrics |
| F4  | 🧊 Consumer stopped  | `WORKER_DISABLED=true`                                | queue lag            | metrics             |
| F5  | ⚡ Redis unavailable | `REDIS_DISABLED=true`                                 | cache miss + latency | logs + metrics      |
| F6  | 🧠 Memory pressure   | `MEMORY_PRESSURE_ENABLED=true MEMORY_PRESSURE_MB=256` | latency/error growth | metrics             |

➡️ Protocol & schema: `docs/failure-injection-protocol.md` · Generate the report: `pnpm failure:report`

---

## 🚀 Quick Start

```bash
# 1. Install & verify
pnpm install
pnpm test          # 42 unit tests
pnpm typecheck
pnpm lint
pnpm build

# 2. Start the base stack (Postgres, Redis, RabbitMQ + services)
docker compose -f infra/docker/compose/docker-compose.base.yml up --build -d
pnpm migrate:postgres
pnpm seed:postgres

# 3. Create a transaction
curl -X POST http://localhost:3000/transactions \
  -H "content-type: application/json" \
  -d '{"userId":"user-1","amount":42,"currency":"USD","description":"Demo"}'
```

Run services locally in watch mode instead: `pnpm dev`

---

## 🔬 Running the Experiments

Each observability mode runs the **same** k6 scenario 3×, samples Docker stats, captures telemetry volume, and writes raw + processed + report artifacts.

<details>
<summary><b>Per-mode experiment commands</b></summary>

```bash
# Phase 3 — Baseline (no observability)
OBS_MODE=none pnpm baseline:run

# Phase 4 — Metrics
OBS_MODE=metrics docker compose -f infra/docker/compose/docker-compose.base.yml --profile metrics up --build -d
pnpm migrate:postgres && pnpm metrics:run

# Phase 5 — Metrics + Logs
OBS_MODE=metrics_logs docker compose -f infra/docker/compose/docker-compose.base.yml --profile metrics --profile logs up --build -d
pnpm migrate:postgres && pnpm metrics-logs:run

# Phase 6 — Metrics + Logs + Traces
OBS_MODE=metrics_logs_traces docker compose -f infra/docker/compose/docker-compose.base.yml --profile metrics --profile logs --profile traces up --build -d
pnpm migrate:postgres && pnpm metrics-logs-traces:run

# Phase 7 — Full OpenTelemetry pipeline
OBS_MODE=otel_full OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
  docker compose -f infra/docker/compose/docker-compose.base.yml --profile metrics --profile logs --profile traces --profile otel up --build -d
pnpm migrate:postgres && pnpm otel-full:run

# Phase 8 — Aggregate all modes into one comparison (no containers needed)
pnpm overhead:report
```

</details>

<details>
<summary><b>Load profiles & failure scenarios (k6)</b></summary>

```bash
# Load profiles — drive the same flow at different shapes
k6 run load-tests/k6/smoke.js
k6 run load-tests/k6/stress.js                       # 50→100→200→500 VUs
k6 run load-tests/k6/spike.js                        # 10→300→10 VUs
k6 run -e VUS=100 -e DURATION=60m load-tests/k6/soak.js

# Failure scenarios — start the stack with a fault flag, then drive load
k6 run load-tests/k6/failure-payment-slow.js
k6 run load-tests/k6/failure-payment-errors.js
k6 run load-tests/k6/failure-db-slow.js
k6 run load-tests/k6/failure-rabbitmq-consumer.js
k6 run load-tests/k6/failure-redis.js

pnpm failure:report                                  # detection / root-cause report + charts
```

</details>

**Dashboards when the stack is up:** Grafana `:3004` · Prometheus `:9090` · Jaeger `:16686` · RabbitMQ `:15674`

---

## 📊 Results & Artifacts

```text
results/
├── raw/         # k6 summaries, Docker stats, telemetry-volume JSON per run
├── processed/   # comparison CSVs (observability-overhead, debuggability)
└── charts/      # dependency-free SVG charts (latency, CPU, memory, overhead, volumes)

docs/
├── observability-overhead-report.md     # Phase 8 cross-mode analysis
├── failure-injection-report.md          # Phase 9 debuggability report
└── failure-injection-protocol.md        # manual measurement protocol
```

---

## 🧱 Shared Packages

| Package                 | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `@traceforge/contracts` | Shared types, constants, and request validation                    |
| `@traceforge/config`    | Typed env parsing — service, runtime, telemetry & **fault** config |
| `@traceforge/logger`    | Structured JSON logs, correlation IDs, Loki/OTLP export            |
| `@traceforge/metrics`   | Prometheus registry + HTTP/DB/Redis/RabbitMQ instruments           |
| `@traceforge/tracing`   | OpenTelemetry SDK, W3C context propagation, span helpers           |

---

## 🗺️ Roadmap

**v1.0 — _Observability Laboratory_ (current)** covers the full measurement story end-to-end:

| ✅  | Phase  |                                                                                                                      |
| :-: | ------ | -------------------------------------------------------------------------------------------------------------------- |
| ✅  | **0**  | Research design — questions, hypotheses, KPIs                                                                        |
| ✅  | **1**  | Monorepo & service foundation                                                                                        |
| ✅  | **2**  | Core business flow (HTTP + SQL + cache + async)                                                                      |
| ✅  | **3**  | Baseline without observability                                                                                       |
| ✅  | **4**  | Metrics                                                                                                              |
| ✅  | **5**  | Metrics + Logs                                                                                                       |
| ✅  | **6**  | Metrics + Logs + Traces                                                                                              |
| ✅  | **7**  | Full OpenTelemetry pipeline                                                                                          |
| ✅  | **8**  | Observability-overhead experiments & charts                                                                          |
| ✅  | **9**  | Failure injection & debuggability tooling                                                                            |
| ✅  | **13** | **Final report & paper draft** — [`final-report.md`](docs/final-report.md) · [`paper-draft.md`](docs/paper-draft.md) |

> 🔭 **Beyond v1 (future research):** PostgreSQL indexing experiments, MongoDB / SQL-vs-NoSQL comparison, and Docker Compose vs Swarm vs Kubernetes orchestration trade-offs.

---

## 🧰 Tech Stack

**Backend** NestJS · TypeScript (strict) · pnpm workspaces
**Data** PostgreSQL · Redis · RabbitMQ
**Observability** OpenTelemetry · Prometheus · Grafana · Loki · Jaeger
**Load & Orchestration** k6 · Docker Compose

---

## 📜 License

Provided as-is for academic and portfolio purposes.

<div align="center">

**Built as a measurement system from day one.** 🔭

</div>
