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
pipeline. Each mode ran an identical k6 workload three times (15 runs). Relative to an
uninstrumented baseline, metrics-only added no measurable latency cost; structured
logging was the dominant contributor (p95 +369.6%, CPU +158.7%); and the full pipeline
showed the worst tail latency (p95 +432.6%, p99 +508.5%) plus a Collector cost of ~18%
CPU and ~79 MiB. Telemetry reached several log entries and spans per request. We report
the trade-offs with their measurement noise and threats to validity, and describe an
implemented failure-injection methodology for the debuggability half of the question.

## 1. Introduction

Tests the usually-assumed claim that observability is "cheap" by measuring it on one
system, one workload, against a true uninstrumented baseline. Research questions:
overhead (RQ1, measured) and debuggability (RQ2, mechanism implemented, measurement
pending).

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

| Mode                    | p95 (ms) | p95 overhead | CPU overhead | Telemetry           |
| ----------------------- | -------: | -----------: | -----------: | ------------------- |
| Baseline                |    12.86 |            — |            — | —                   |
| Metrics                 |    10.82 |       −15.9% |       −19.8% | —                   |
| Metrics + Logs          |    60.37 |      +369.6% |      +158.7% | ~5.7 logs/req       |
| Metrics + Logs + Traces |    27.39 |      +113.0% |      +118.0% | ~6.7 spans/req      |
| Full OTel               |    68.47 |      +432.6% |      +143.8% | Collector ≈ 18% CPU |

Full latency, resource, telemetry-volume, and overhead tables and six charts are in the
report (§6).

## 6. Discussion

Logging — not tracing — dominated overhead at this load; the non-monotonic
logs-vs-traces ordering is run-to-run noise (the logs mode had 51.6% p95 variance), not
a tracing speed-up; the full pipeline has the worst tail latency; telemetry volume is
the quieter cost that compounds in production. (Report §7.)

## 7. Threats to Validity & Limitations

Micro-load with large percentage sensitivity; run-to-run variance; point-in-time
capture on one host; peak-sampled memory; pinned image versions; debuggability (RQ2)
not yet measured. (Report §8–9.)

## 8. Future Work

Complete the debuggability measurement; heavier/longer workloads; sampling study;
PostgreSQL and MongoDB indexing experiments; orchestration comparison. (Report §10.)

## 9. Conclusion

Observability is not free and its cost is uneven across the three pillars: metrics were
effectively free at this load, logging dominated, and the full pipeline cost the most in
tail latency and added a dedicated Collector process. These measured trade-offs set up
the project's next question — how much debugging speed that overhead buys. (Report §11.)

## References

OpenTelemetry, Prometheus, Loki, Jaeger, k6, and Docker Compose documentation; see the
report's reference list.
