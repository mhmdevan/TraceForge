# Paper Draft

**Title:** Performance and Debuggability Trade-offs of Observability Instrumentation in Containerized Microservice Systems

**Authors:** TraceForge project (v1.0)

> This is a condensed paper skeleton. The full write-up — methodology, all tables,
> charts, threats to validity, and reproducibility — is in
> [`final-report.md`](./final-report.md).

---

## Abstract

Observability instrumentation in microservices is widely adopted but its runtime
cost is usually assumed rather than measured. We present a controlled, experiment-first
evaluation on a single containerized transaction flow (HTTP, PostgreSQL, Redis,
RabbitMQ) instrumented behind one switch that selects five observability depths: none,
metrics, metrics+logs, metrics+logs+traces, and a full OpenTelemetry Collector
pipeline. The primary evaluation drives each mode with an open-model load, repeated ten
times in randomized order, analysed non-parametrically (bootstrap CIs, Kruskal–Wallis,
Mann–Whitney U, Cliff's delta). Relative to an uninstrumented baseline, metrics-only was
**not statistically distinguishable** (CIs overlap); **structured logging was the
dominant contributor** (CPU +164%, median latency +177%, p < 0.001, δ = 1.0) with severe
tail-latency spikes; and the full OpenTelemetry pipeline held CPU near the tracing level
(+51%) with the lowest latency variance, owing to batched asynchronous export. We further
measure the debuggability benefit objectively (MTTD): an injected fault is automatically
undetectable without a metrics pipeline and detected within ~one scrape interval with one.

## 1. Introduction

Tests the usually-assumed claim that observability is "cheap" by measuring it on one
system, one workload, against a true uninstrumented baseline. Research questions:
overhead (RQ1, measured) and debuggability (RQ2: detection measured objectively via
MTTD; root-cause analysis a pending operator study).

## 2. Background

Metrics vs logs vs traces; OpenTelemetry and the Collector; containerized,
profile-based deployment. (Full text in the report, §2.)

## 3. System Architecture

Four NestJS services and a transaction flow crossing PostgreSQL, Redis, an HTTP payment
call, and RabbitMQ; observability layers toggled by one `OBS_MODE` variable. (Report §3.)

## 4. Methodology

Identical k6 baseline scenario across all modes; additive observability modes; overhead
defined as `((observed − baseline) / baseline) × 100`; failure injection via
environment-toggled faults and a fixed manual debugging protocol. (Report §4.)

## 5. Key Results

Primary result — realistic campaign, N = 10 per mode (median [95% CI]):

| Mode                    | CPU % [95% CI]    | CPU overhead | p50 (ms) | Differs from baseline? |
| ----------------------- | ----------------- | -----------: | -------: | ---------------------- |
| Baseline                | 5.6 [5.3, 7.2]    |            — |     1.72 | —                      |
| Metrics                 | 8.3 [5.2, 13.6]   |         +48% |     2.71 | no (CIs overlap)       |
| Metrics + Logs          | 14.9 [13.7, 19.6] |        +164% |     4.77 | yes (p<0.001, δ=1.0)   |
| Metrics + Logs + Traces | 8.9 [8.2, 13.2]   |         +59% |     2.89 | yes (p=0.003)          |
| Full OTel               | 8.5 [7.2, 9.6]    |         +51% |     3.33 | yes (p<0.001)          |

Kruskal–Wallis confirms cross-mode differences (CPU H=24.2, p<0.001; p50 H=23.1,
p<0.001). Full tables, p95/memory, and box plots are in `statistics-load-report.md`; the
preliminary 15-run micro-benchmark is in the report (§6.1–6.4).

## 6. Discussion

Logging — not tracing — dominated overhead at this load; the non-monotonic
logs-vs-traces ordering is run-to-run noise (the logs mode had 51.6% p95 variance), not
a tracing speed-up; the full pipeline has the worst tail latency; telemetry volume is
the quieter cost that compounds in production. (Report §7.)

## 7. Threats to Validity & Limitations

Micro-load with large percentage sensitivity; run-to-run variance; point-in-time
capture on one host; peak-sampled memory; pinned image versions. RQ2 detection is
measured objectively (MTTD via alert firing); RQ2 root-cause is an unrun operator
study. (Report §6.5, §8–9.)

## 8. Future Work

Complete the debuggability measurement; heavier/longer workloads; sampling study;
PostgreSQL and MongoDB indexing experiments; orchestration comparison. (Report §10.)

## 9. Conclusion

Observability is not free and its cost is uneven across the three pillars: metrics were
effectively free at this load, logging dominated, and the full pipeline cost the most in
tail latency and added a dedicated Collector process. These measured trade-offs set up
the project's next question — how much debugging speed that overhead buys. (Report §11.)

## References

See [`related-work.md`](./related-work.md) for the full thematic literature review and
reference list (observability overhead, tracing systems, benchmarking methodology,
indexing, orchestration), plus the OpenTelemetry, Prometheus, Loki, Jaeger, k6, and
Docker documentation.
