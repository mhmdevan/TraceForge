# Objective Mean-Time-To-Detect (RQ2)

Generated at: 2026-06-05T16:17:47.446Z

## Method

Detection is measured objectively, with no human in the loop: each fault is injected into a freshly started stack, a constant-arrival-rate load is applied at a recorded `T0`, and the relevant Prometheus alert is polled until it becomes **active (pending)** and then **firing**. MTTD is the elapsed time from `T0`. The **baseline** mode has no metrics pipeline, so no alert can ever fire — automated detection is impossible by construction. This isolates the *detection* half of debuggability; *root-cause* time (which logs and traces accelerate) is a separate measurement (see `failure-injection-protocol.md`).

## Results

| Fault | Mode | Alert | Detected | Time→pending (s) | Time→firing (s) | Baseline symptom (k6) |
| --- | --- | --- | --- | ---: | ---: | --- |
| F2 Payment 500 errors | baseline | TraceForgeHttpErrors | ❌ no | — | — | err=0.12, p95=7ms |
| F2 Payment 500 errors | metrics | TraceForgeHttpErrors | ✅ yes | 9.4 | 70.3 | — |
| F1 Slow payment | baseline | TraceForgeHighP95Latency | ❌ no | — | — | err=0.00, p95=1007ms |
| F1 Slow payment | metrics | TraceForgeHighP95Latency | ✅ yes | 9.7 | 72.2 | — |

## Figure

![mttd-detection.svg](../results/charts/mttd-detection.svg)

## Finding

- **Step change, not a gradient.** Without observability the fault is real (k6 records the degraded error rate / latency) yet **undetectable by any automated means**. The metrics pipeline converts this into detection within a bounded, configurable time.
- **Detection latency is dominated by alert configuration**, not observability depth: time-to-pending tracks the scrape interval, and time-to-firing adds the alert's `for:` debounce. Metrics, logs, and traces share the same metric-based alerts, so they detect equally fast; the additional value of logs/traces is in root-cause, measured separately.

## Reproduce

```bash
pnpm mttd:run   # requires Docker; uses the metrics Compose profile + Prometheus alerts
```
