# Performance and Debuggability Trade-offs of Observability Instrumentation in a Containerized Microservice System

**Project:** TraceForge — Observable Microservice Lab
**Version:** v1.0 (Phases 0–9)
**Status of results:** Observability-overhead measurements are real — the primary result is a realistic open-model campaign (N = 10 per mode, §6.0); an earlier 15-run micro-benchmark (§6.1–6.4) is retained for context. The RQ2 **detection** half is now measured objectively (mean-time-to-detect via Prometheus alert firing; see §6.5); the **root-cause** half (human-in-the-loop) remains an implemented-but-unrun protocol and is explicitly _not_ reported as a finding here.

---

## Abstract

Observability instrumentation — metrics, structured logs, and distributed traces — is widely adopted in microservice systems, but its runtime cost is often assumed rather than measured. This report presents a controlled, experiment-first evaluation of how increasing observability depth affects latency, CPU, memory, and telemetry volume in a containerized microservice application. A single transaction-processing flow spanning HTTP, PostgreSQL, Redis, and RabbitMQ was instrumented behind one environment switch (`OBS_MODE`) that selects between five modes: no observability, metrics only, metrics + logs, metrics + logs + traces, and a full OpenTelemetry Collector pipeline. In the primary evaluation each mode was driven by an open-model load and repeated ten times in randomized order, with non-parametric inference (bootstrap confidence intervals, Kruskal–Wallis, Mann–Whitney U, Cliff's delta). Relative to the uninstrumented baseline, metrics-only instrumentation was **not statistically distinguishable** (CPU and median-latency confidence intervals overlap baseline); **structured logging was the single largest contributor** to overhead (CPU +164%, median latency +177%, both p < 0.001, Cliff's δ = 1.0) and produced severe tail-latency spikes; and the full OpenTelemetry pipeline — despite carrying the most telemetry — held CPU near the tracing level (+51%) with the lowest latency variance, owing to its batched, asynchronous export. Telemetry volume scaled to roughly 5.7 log entries and 6.7 spans per request. We further measure the debuggability benefit objectively: without a metrics pipeline an injected fault (a 12% error rate; a ~1-second p95) is automatically undetectable, whereas any metrics-bearing mode detects it within roughly one scrape interval and pages within the alert debounce — a step change rather than a gradient. We discuss the practical implications of these trade-offs and document threats to validity.

---

## 1. Introduction

A common pattern in microservice engineering is to add observability tooling — Prometheus metrics, JSON logs shipped to Loki, OpenTelemetry traces — and assume the cost is negligible relative to the operational benefit. That assumption is rarely tested under controlled conditions on the same system, with the same workload, and against a true uninstrumented baseline.

TraceForge was built to test it. The project is deliberately **experiment-first**: rather than demonstrating that a microservice application works, it is designed as a measurement instrument that can be run repeatedly to quantify the cost of observability and, separately, the debugging value it provides.

This report addresses two research questions for v1:

- **RQ1 (Overhead).** How does each level of observability instrumentation affect latency, throughput, CPU usage, memory usage, and telemetry volume?
- **RQ2 (Debuggability).** How much do metrics, logs, and traces reduce failure detection time and root-cause analysis time?

RQ1 is answered here with measured data. RQ2's **detection** half is answered objectively (§6.5); its **root-cause** half is left as an implemented protocol for a future operator study, and no human timings are fabricated.

---

## 2. Background

### 2.1 Microservice observability

In a distributed system a single user request fans out across multiple services and infrastructure components. When something degrades, the operator must localize the fault across that fan-out. Observability is the property that internal state can be inferred from external outputs — primarily the three "pillars": metrics, logs, and traces.

### 2.2 Metrics, logs, and traces

- **Metrics** are numeric time series (counters, histograms) that are cheap to aggregate and ideal for dashboards and alerting, but lossy about individual requests.
- **Logs** are discrete, often structured events. They carry rich per-request context (correlation IDs, status, duration) at a higher storage and emission cost.
- **Traces** record the causal path of a request as a tree of spans across services, which is the most direct tool for cross-service latency localization, at the highest per-request data cost.

### 2.3 OpenTelemetry

OpenTelemetry (OTel) is a vendor-neutral standard and SDK for generating and exporting all three signal types over the OTLP protocol. A central **Collector** can receive telemetry from services and route it to backends (Prometheus, Loki, Jaeger/Tempo), decoupling services from backend specifics at the cost of an additional process.

### 2.4 Containerized deployment

All components run under Docker Compose with explicit resource boundaries, health checks, and networks, which makes the experiment reproducible on a single machine. Observability backends are attached through Compose profiles so that each mode starts exactly the components it needs and nothing more.

### 2.5 Out-of-scope background (future work)

Database indexing strategy and orchestration-platform comparison (Swarm, Kubernetes) are part of the broader research design but are outside the v1 scope of this report; see §10.

---

## 3. System Architecture

The domain is transaction processing because it naturally exercises writes, read-heavy queries, an external service call, and asynchronous events. A single request path crosses every relevant boundary:

```text
POST /transactions
  -> API Gateway
  -> Transaction Service
       -> PostgreSQL  (write)
       -> Redis       (cache)
       -> Payment Service (HTTP)
       -> RabbitMQ    (publish)
            -> Worker Service (consume)
                 -> PostgreSQL (persist event)
```

Four NestJS/TypeScript services participate:

| Service             | Responsibility                                                         |
| ------------------- | ---------------------------------------------------------------------- |
| API Gateway         | Public HTTP API; correlation-ID and trace-context propagation          |
| Transaction Service | Core flow; PostgreSQL writes, Redis cache, payment call, event publish |
| Payment Service     | Simulated payment authorization; fault injection                       |
| Worker Service      | Consumes transaction events from RabbitMQ and persists them            |

Five shared packages (`contracts`, `config`, `logger`, `metrics`, `tracing`) centralize types, typed environment parsing, structured logging, the Prometheus registry, and the OpenTelemetry SDK. Each observability layer degrades to a no-op when its mode is not active, so the same binaries run in every mode and only instrumentation changes.

In `otel_full` mode, services export logs and traces over OTLP to an OpenTelemetry Collector, which scrapes service metrics and routes the three signal types to Prometheus, Loki, and Jaeger respectively.

---

## 4. Methodology

### 4.1 Workload design

A single k6 scenario drives the full transaction flow (`create → read → user history`). The same script is used in every mode so that results are directly comparable. The shared baseline profile uses a small constant load (4 virtual users, ~8 seconds per run); each experiment repeats the run three times. Larger profiles (stress, spike, soak) exist for separate stress characterization but are not part of the cross-mode comparison.

### 4.2 Observability modes

Observability depth is selected by one environment variable. Every layer is additive:

| `OBS_MODE`            | Metrics | Logs | Traces | Collector |
| --------------------- | :-----: | :--: | :----: | :-------: |
| `none`                |   no    |  no  |   no   |    no     |
| `metrics`             |   yes   |  no  |   no   |    no     |
| `metrics_logs`        |   yes   | yes  |   no   |    no     |
| `metrics_logs_traces` |   yes   | yes  |  yes   |    no     |
| `otel_full`           |   yes   | yes  |  yes   |    yes    |

_Table 1. Observability modes and the signals each enables._

### 4.3 Failure injection design

Six faults are implemented as real, environment-toggled code paths (all off by default) to support debuggability measurement:

| ID  | Scenario                  | Service             | Trigger                                               | Expected symptom     | Best tool           |
| --- | ------------------------- | ------------------- | ----------------------------------------------------- | -------------------- | ------------------- |
| F1  | Slow payment              | payment-service     | `PAYMENT_MODE=slow PAYMENT_DELAY_MS=1000`             | high latency         | traces              |
| F2  | Payment 500 errors        | payment-service     | `PAYMENT_ERROR_RATE=0.2`                              | error-rate spike     | metrics + logs      |
| F3  | Slow DB query             | transaction-service | `DB_SLOW_QUERY=true DB_SLOW_QUERY_DELAY_MS=500`       | p95 increase         | traces + DB metrics |
| F4  | RabbitMQ consumer stopped | worker-service      | `WORKER_DISABLED=true`                                | queue lag            | metrics             |
| F5  | Redis unavailable         | transaction-service | `REDIS_DISABLED=true`                                 | cache miss + latency | logs + metrics      |
| F6  | Memory pressure           | transaction-service | `MEMORY_PRESSURE_ENABLED=true MEMORY_PRESSURE_MB=256` | latency/error growth | metrics             |

_Table 2. Implemented failure scenarios._

Debuggability is measured by a fixed manual protocol (`docs/failure-injection-protocol.md`): inject a fault at a recorded timestamp, then — using only the telemetry available in the current mode and without reading source code — record the first visible symptom, the first alert, and the time the root cause is identified. A report generator (`pnpm failure:report`) converts recorded observations into `time_to_detect` and `time_to_root_cause` and computes the improvement of `otel_full` over the baseline. These human runs are pending; see §6.5 and §9.

### 4.4 Indexing experiment design (future)

Out of v1 scope. See §10.

### 4.5 Deployment comparison design (future)

Out of v1 scope. See §10.

---

## 5. Experiment Setup

| Parameter           | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| Services            | 4 (api-gateway, transaction, payment, worker)              |
| Datastores          | PostgreSQL 16, Redis 7, RabbitMQ 3                         |
| Observability stack | Prometheus, Grafana, Loki, Jaeger, OpenTelemetry Collector |
| Orchestration       | Docker Compose (profiles per mode)                         |
| Load generator      | k6, identical baseline scenario across all modes           |
| Virtual users       | 4                                                          |
| Run duration        | ~8 s per run                                               |
| Repetitions         | 3 runs per mode (15 runs total)                            |
| Trace sampling      | 100% (`OTEL_TRACES_SAMPLER_ARG=1`)                         |
| Captured per run    | k6 summary, Docker CPU/memory stats, telemetry volume      |
| Overhead definition | `((observed − baseline) / baseline) × 100`                 |

_Table 3. Experiment configuration._

All raw artifacts are stored under `results/raw/`, processed comparisons under `results/processed/`, and charts under `results/charts/`. The cross-mode aggregation is produced by `pnpm overhead:report`, which is deterministic given the same inputs.

---

## 6. Results

> **Two measurements are reported.** §6.0 is the **primary** result — a realistic,
> statistically-powered campaign (open-model load, N = 10 per mode, bootstrap CIs,
> non-parametric tests). §6.1–6.4 are an earlier **preliminary micro-benchmark**
> (3 runs, few VUs), retained for context; where they disagree, §6.0 supersedes them.

### 6.0 Primary result: realistic load campaign (N = 10)

Each mode was driven by an open-model constant-arrival-rate load (~90 req/s) and
repeated **10 times in randomized mode order**, after a discarded warm-up, with images
rebuilt from current source. Distributions are non-normal, so all inference is
non-parametric (medians, bootstrap 95% CIs, Kruskal–Wallis, Mann–Whitney U, Cliff's δ).
Full tables and box plots: [`statistics-load-report.md`](./statistics-load-report.md).

**CPU overhead (robust; low variance):**

| Mode                    | Median CPU % [95% CI] | Overhead |  MWU p | Cliff's δ    | Differs from baseline? |
| ----------------------- | --------------------- | -------: | -----: | ------------ | ---------------------- |
| Baseline                | 5.6 [5.3, 7.2]        |        — |      — | —            | —                      |
| Metrics                 | 8.3 [5.2, 13.6]       |     +48% |   0.34 | 0.26 (small) | no (CI overlaps)       |
| Metrics + Logs          | 14.9 [13.7, 19.6]     |    +164% | <0.001 | 1.00 (large) | **yes**                |
| Metrics + Logs + Traces | 8.9 [8.2, 13.2]       |     +59% |  0.003 | 0.80 (large) | **yes**                |
| Full OpenTelemetry      | 8.5 [7.2, 9.6]        |     +51% |  0.011 | 0.68 (large) | borderline (overlaps)  |

**Median (p50) latency:**

| Mode                    | Median p50 ms [95% CI] | Overhead |  MWU p | Differs?         |
| ----------------------- | ---------------------- | -------: | -----: | ---------------- |
| Baseline                | 1.72 [1.64, 1.91]      |        — |      — | —                |
| Metrics                 | 2.71 [1.64, 5.28]      |     +58% |   0.31 | no (CI overlaps) |
| Metrics + Logs          | 4.77 [4.10, 16.92]     |    +177% | <0.001 | **yes**          |
| Metrics + Logs + Traces | 2.89 [2.49, 4.55]      |     +69% | <0.001 | **yes**          |
| Full OpenTelemetry      | 3.33 [2.68, 4.05]      |     +94% | <0.001 | **yes**          |

Kruskal–Wallis confirms the modes differ overall (CPU H = 24.2, p < 0.001; p50
H = 23.1, p < 0.001; p95 H = 16.2, p = 0.003). Three findings are robust:

1. **Metrics are essentially free.** Metrics-only overhead is not statistically
   distinguishable from baseline for either CPU (p = 0.34) or p50 latency (p = 0.31);
   both CIs overlap baseline.
2. **Structured logging is the dominant cost.** Metrics + Logs has the highest CPU
   (+164%) and p50 latency (+177%), both highly significant (p < 0.001, δ = 1.00,
   non-overlapping CIs). Synchronous log shipping also produced severe **p95 tail
   spikes** (one run reached ~4.8 s) — the only mode whose p95 CI excludes baseline.
3. **The batched OTLP pipeline is comparatively smooth.** Full OpenTelemetry carries the
   most telemetry yet holds CPU near the traces level (+51%) with the lowest latency
   variance among instrumented modes — its asynchronous, batched export avoids the
   per-request stalls that synchronous logging induces.

Absolute latency percentages remain sensitive to the load point (a ~5 ms baseline makes
small absolute additions large in relative terms); the **CPU result and the qualitative
ordering are the load-robust conclusions**.

#### 6.0.1 Latency–throughput sweep

To characterize the load-dependence directly, we swept three modes across offered rates
from 60 to 480 req/s (`pnpm sweep:run`; full tables in `docs/load-sweep-report.md`). At
60 req/s all modes lie within ~10–40 ms p95 — the overhead is small in absolute terms at
low load. As load rises the modes saturate **in order of instrumentation depth**: baseline
sustains the full 480 req/s (p95 flat at ~5–9 ms); Metrics + Logs falls behind beyond
~240 req/s; and Full OpenTelemetry saturates earliest, plateauing near **220 req/s — less
than half of baseline's capacity** — with p95 climbing into the multi-second range past its
knee. The dominant cost of the heavier pipelines is thus a **reduction in maximum
sustainable throughput**, not a fixed per-request tax.

![Achieved vs offered throughput](../results/charts/sweep-throughput.svg)

> Caveat: k6 runs on the same host as the system under test, so the highest-load latencies
> include some load-generator contention and should be read as an upper bound.

### 6.1 Latency by mode (preliminary micro-benchmark)

| Mode                    | p50 (ms) | p95 (ms) | p99 (ms) | p95 variance | Req/run |
| ----------------------- | -------: | -------: | -------: | -----------: | ------: |
| Baseline (`none`)       |     3.49 |    12.86 |    36.12 |         9.6% |     820 |
| Metrics                 |     3.29 |    10.82 |    19.11 |        16.9% |     836 |
| Metrics + Logs          |     6.22 |    60.37 |   133.07 |        51.6% |     663 |
| Metrics + Logs + Traces |     5.64 |    27.39 |    96.99 |        22.2% |     743 |
| Full OTel               |     9.08 |    68.47 |   219.83 |        25.1% |     600 |

_Table 4. Aggregated latency and throughput proxy (mean of 3 runs)._

![Latency by mode](../results/charts/latency-comparison.svg)

The throughput proxy (requests completed per fixed-duration run) falls from 820 at baseline to 600 under the full pipeline — about 27% fewer completed requests — consistent with the rising latency.

### 6.2 Overhead vs baseline

| Mode                    | p95 overhead | p99 overhead | CPU overhead | Memory overhead |
| ----------------------- | -----------: | -----------: | -----------: | --------------: |
| Metrics                 |       −15.9% |       −47.1% |       −19.8% |          +11.3% |
| Metrics + Logs          |      +369.6% |      +268.4% |      +158.7% |          −21.3% |
| Metrics + Logs + Traces |      +113.0% |      +168.5% |      +118.0% |          −13.4% |
| Full OTel               |      +432.6% |      +508.5% |      +143.8% |          −18.7% |

_Table 5. Overhead relative to the uninstrumented baseline._

![p95 overhead vs baseline](../results/charts/p95-overhead.svg)

Two results stand out. First, **metrics-only instrumentation has no measurable latency cost** at this load — its p95 is slightly _below_ baseline, which is within the observed run-to-run variance and should be read as "no detectable overhead", not as a speed-up. Second, **adding structured logging is the single largest step**: p95 jumps from ~11 ms to ~60 ms and CPU more than doubles.

### 6.3 Resource cost and telemetry volume

| Mode                    | Mean CPU | Max memory | Logs / 10k req | Spans / 10k req | Est. log storage |
| ----------------------- | -------: | ---------: | -------------: | --------------: | ---------------: |
| Baseline                |    6.05% |  172.2 MiB |              — |               — |                — |
| Metrics                 |    4.85% |  191.7 MiB |              — |               — |                — |
| Metrics + Logs          |   15.64% |  135.5 MiB |        ~56,968 |               — |          3.4 MiB |
| Metrics + Logs + Traces |   13.18% |  149.2 MiB |        ~56,918 |         ~66,712 |          4.4 MiB |
| Full OTel               |   14.74% |  140.0 MiB |        ~56,961 |         ~66,728 |          8.9 MiB |

_Table 6. Resource usage and telemetry volume (max memory is peak sampled; storage is estimated from sampled entry sizes)._

![CPU by mode](../results/charts/cpu-comparison.svg)

![Memory by mode](../results/charts/memory-comparison.svg)

Telemetry volume is substantial: roughly **5.7 log entries and 6.7 spans per request**. Estimated log storage grows from 3.4 MiB (`metrics_logs`) to 8.9 MiB (`otel_full`) for a comparable number of entries, because the average OTLP log record (~912 bytes) is far larger than the direct Loki push (~313 bytes) — the OTLP envelope and resource attributes dominate.

![Log volume](../results/charts/log-volume.svg)

![Trace volume](../results/charts/trace-volume.svg)

### 6.4 OpenTelemetry Collector cost

In `otel_full` mode the Collector is a dedicated process. It consumed approximately **18.0% CPU** and a peak of **79.2 MiB** of memory. Notably, service memory in the collector modes was _lower_ than baseline; this is discussed in §8 as a sampling/timing artifact rather than a real reduction. The architectural value of the Collector is that it moves part of the telemetry cost out of the service processes and centralizes routing.

### 6.5 Debuggability (RQ2): objective detection

RQ2 has two halves: **detection** (how fast a fault is noticed) and **root-cause**
(how fast it is diagnosed). The detection half is measured here **objectively**, with
no human in the loop: each fault is injected into a freshly built stack, a
constant-arrival-rate load is applied at a recorded `T0`, and the relevant Prometheus
alert is polled until it becomes active and then fires (`pnpm mttd:run`). MTTD is the
elapsed time from `T0`.

| Fault              | Mode     | Detected | Time→pending (s) | Time→firing (s) | Baseline symptom |
| ------------------ | -------- | -------- | ---------------: | --------------: | ---------------- |
| Payment 500 errors | Baseline | **no**   |                — |               — | 12% error rate   |
| Payment 500 errors | Metrics  | yes      |              9.4 |            70.3 | —                |
| Slow payment       | Baseline | **no**   |                — |               — | p95 ≈ 1007 ms    |
| Slow payment       | Metrics  | yes      |              9.7 |            72.2 | —                |

![Objective MTTD](../results/charts/mttd-detection.svg)

The result is a **step change, not a gradient**: without a metrics pipeline the fault
is real and severe (a 12% error rate; a ~1-second p95) yet **automatically
undetectable**. Any metrics-bearing mode detects the anomaly within roughly one scrape
interval (~9 s to pending) and pages within the alert's `for:` debounce (~70 s to
firing). Because metrics, logs, and traces share the same metric-based alerts, they
detect equally fast; detection latency is therefore governed by alert configuration,
not observability depth. The additional value of logs and traces lies in the
**root-cause** half, which is the harder, human-in-the-loop measurement: that protocol
and tooling are implemented (`docs/failure-injection-protocol.md`, `pnpm failure:report`)
and remain to be run as a controlled operator study. Full results:
`docs/mttd-report.md`.

---

## 7. Discussion

**Logging, not tracing, dominated the overhead at this load.** The largest single jump was metrics → metrics+logs (p95 ×~5.6, CPU ×~2.6). This is consistent with each request emitting several structured log records that are serialized to JSON and pushed over the network; the per-request work and the network egress are both on or near the request path.

**The non-monotonic latency between `metrics_logs` (60.4 ms p95) and `metrics_logs_traces` (27.4 ms p95) is noise, not a tracing speed-up.** The `metrics_logs` mode had the highest run-to-run variance of any mode (51.6%), meaning a single slow run inflated its mean. At a workload this small, absolute latencies are tiny and a few-millisecond perturbation produces large percentage swings. The honest reading is that logs and traces both add substantial overhead and their exact ordering at this scale is within measurement noise.

**The full pipeline has the worst tail latency.** `otel_full` produced the highest p95 (68.5 ms) and p99 (219.8 ms). OTLP export plus the Collector hop adds latency and the largest per-record payloads, and the throughput proxy confirms the system completes the fewest requests in this mode.

**Telemetry volume is the quieter cost.** Even at trivial load the system emits thousands of logs and spans per ten thousand requests, and OTLP log records are roughly 3× larger than direct pushes. In production this is the cost that compounds: storage, indexing, and egress scale with traffic far past the CPU/latency cost measured here. Sampling is the standard mitigation and is configurable in this system.

---

## 8. Threats to Validity

- **Micro-load.** The comparison workload is small (4 VUs, ~8 s). Absolute latencies are low, so percentage overheads are large and sensitive to single-run perturbations. The `p95 variance` column is reported precisely so readers can weight each mode's stability.
- **Run-to-run variance.** Three repetitions bound but do not eliminate noise; the `metrics_logs` variance (51.6%) is high enough that its mean should be treated cautiously.
- **Point-in-time capture.** The five modes were captured at different times on one machine; background host activity can shift CPU and memory readings between modes.
- **Peak-sampled memory.** Memory is the maximum sampled container memory, not steady-state. At this load it is dominated by runtime/heap baselines rather than telemetry buffers, which is why heavier modes can show _lower_ peaks — an artifact, not a real reduction.
- **Pinned versions.** Results are tied to specific image versions (e.g. the Collector); conclusions may shift with upgrades.
- **Single domain and workload shape.** One transaction flow under one load profile; other access patterns may apportion overhead differently.

---

## 9. Limitations

- RQ2's **detection** half is measured objectively (§6.5); its **root-cause** half is **not yet measured** — only the mechanism and protocol are delivered, and no root-cause findings are claimed.
- The workload does not stress the system to saturation in the comparison runs; this isolates instrumentation overhead but does not characterize behavior under heavy contention.
- No statistical significance testing is performed beyond mean and run-to-run variance; with three runs, confidence intervals would be wide.

---

## 10. Future Work

- **Complete RQ2's root-cause half:** run the failure-injection protocol as a controlled operator study (multiple participants, randomized) to quantify how much logs and traces reduce time-to-root-cause — the detection half is already measured objectively (§6.5).
- **Heavier and longer workloads:** repeat the overhead comparison at higher VU counts and with the soak profile to separate instrumentation overhead from queueing effects and to surface leaks.
- **Sampling study:** measure how trace/log sampling ratios trade telemetry volume against debuggability.
- **Database indexing experiments (Phase 10):** PostgreSQL index strategies under load, read improvement vs write penalty.
- **NoSQL comparison (Phase 11):** equivalent MongoDB indexing experiments and a careful SQL-vs-NoSQL comparison.
- **Orchestration comparison (Phase 12):** Docker Compose vs Swarm vs Kubernetes for startup, scaling, recovery, and observability-integration cost.

---

## 11. Conclusion

On a controlled, repeatable microservice testbed, observability is not free, and its cost is highly uneven across the three pillars. Metrics-only instrumentation imposed no measurable latency penalty at this load. Structured logging was the dominant cost (p95 +369.6%, CPU +158.7%), and the full OpenTelemetry pipeline produced the worst tail latency (p95 +432.6%, p99 +508.5%) plus a dedicated Collector cost of ~18% CPU and ~79 MiB. Telemetry volume reached several log entries and spans per request, with OTLP records markedly larger than direct pushes. These are measured trade-offs, reported with their noise and their threats to validity, and they set up the unanswered half of the project: quantifying how much faster a fault can be detected and diagnosed once that overhead has been paid.

---

## Reproducibility

The full comparison can be regenerated from the stored results without re-running any containers:

```bash
pnpm install
pnpm overhead:report      # rebuilds results/processed + results/charts + this report's data
```

To re-measure a single mode end-to-end (requires Docker and k6), for example the full pipeline:

```bash
OBS_MODE=otel_full OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
  docker compose -f infra/docker/compose/docker-compose.base.yml \
  --profile metrics --profile logs --profile traces --profile otel up --build -d
pnpm migrate:postgres
pnpm otel-full:run
pnpm overhead:report
```

Every experiment uses the same dataset, load script, Docker resources, and duration; raw results are written under `results/raw/<mode>-<timestamp>/`.

---

## References

A thematic literature review that positions this study against prior work on
observability overhead, tracing systems, benchmarking methodology, indexing, and
orchestration is in [`docs/related-work.md`](./related-work.md). The primary
implementation/tooling sources are:

- OpenTelemetry Documentation — https://opentelemetry.io/docs/
- OpenTelemetry Collector — https://opentelemetry.io/docs/collector/
- Prometheus Documentation — https://prometheus.io/docs/introduction/overview/
- Grafana Loki Documentation — https://grafana.com/docs/loki/latest/
- Jaeger Documentation — https://www.jaegertracing.io/docs/latest/
- Grafana k6 Documentation — https://grafana.com/docs/k6/latest/
- Docker Compose Documentation — https://docs.docker.com/compose/

---

_Companion documents: `docs/observability-overhead-report.md` (generated cross-mode analysis), `docs/failure-injection-protocol.md` (measurement protocol), `docs/paper-draft.md` (condensed paper skeleton)._
