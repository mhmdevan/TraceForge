# Observability Overhead Report

Generated at: 2026-06-05T09:51:05.731Z

## Overview

This report compares the five observability modes (E0-E4) defined in the experiment matrix. Each mode was executed with the same k6 baseline scenario and the same Docker resources; only the observability instrumentation changed. All values are aggregated from the per-mode results stored under `results/`.

- Observability modes compared: 5
- Total experiment runs: 15
- Runs per mode: 3, 3, 3, 3, 3
- Overhead formula: `((observed - baseline) / baseline) * 100`
- Baseline mode: `Baseline (none)` (OBS_MODE=none)

## Experiment Summary

| Mode | OBS_MODE | Runs | Req/run | Error rate | p50 ms | p95 ms | p99 ms | p95 var % | CPU % | Max mem (MiB) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline (none) | none | 3 | 820 | 0.0000 | 3.49 | 12.86 | 36.12 | 9.6 | 6.05 | 172.2 |
| Metrics Only | metrics | 3 | 836 | 0.0000 | 3.29 | 10.82 | 19.11 | 16.9 | 4.85 | 191.7 |
| Metrics + Logs | metrics_logs | 3 | 663 | 0.0000 | 6.22 | 60.37 | 133.07 | 51.6 | 15.64 | 135.5 |
| Metrics + Logs + Traces | metrics_logs_traces | 3 | 743 | 0.0000 | 5.64 | 27.39 | 96.99 | 22.2 | 13.18 | 149.2 |
| Full OpenTelemetry Pipeline | otel_full | 3 | 600 | 0.0000 | 9.08 | 68.47 | 219.83 | 25.1 | 14.74 | 140.0 |

## Overhead vs Baseline

| Mode | p50 overhead | p95 overhead | p99 overhead | CPU overhead | Memory overhead |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline (none) | +0.0% | +0.0% | +0.0% | +0.0% | +0.0% |
| Metrics Only | -5.6% | -15.9% | -47.1% | -19.8% | +11.3% |
| Metrics + Logs | +78.3% | +369.6% | +268.4% | +158.7% | -21.3% |
| Metrics + Logs + Traces | +61.7% | +113.0% | +168.5% | +118.0% | -13.4% |
| Full OpenTelemetry Pipeline | +160.4% | +432.6% | +508.5% | +143.8% | -18.7% |

## OpenTelemetry Collector Cost

- Mean Collector CPU: 18.00%
- Max Collector memory: 79.2 MiB
- In `otel_full` mode services export through the Collector instead of writing to each backend directly, which moves part of the telemetry cost out of the service processes and into the Collector container.

## Telemetry Volume

| Mode | Log entries / 10k req | Est. log storage (MiB) | Traces / 10k req | Spans / 10k req | Complete main-flow trace rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Metrics + Logs | 56968 | 3.38 | 0 | 0 | 0.0% |
| Metrics + Logs + Traces | 56918 | 4.36 | 10045 | 66712 | 100.0% |
| Full OpenTelemetry Pipeline | 56961 | 8.92 | 10061 | 66728 | 100.0% |

## Charts

![latency-comparison.svg](../results/charts/latency-comparison.svg)

![cpu-comparison.svg](../results/charts/cpu-comparison.svg)

![memory-comparison.svg](../results/charts/memory-comparison.svg)

![p95-overhead.svg](../results/charts/p95-overhead.svg)

![log-volume.svg](../results/charts/log-volume.svg)

![trace-volume.svg](../results/charts/trace-volume.svg)

## Analysis

- **Metrics Only**: kept mean p95 latency within run-to-run noise of baseline (-15.9%); CPU was 20% lower (noise).
- **Metrics + Logs**: increased mean p95 latency by 370%; CPU rose 159%. Telemetry cost: ~56968 log entries / 10k req.
- **Metrics + Logs + Traces**: increased mean p95 latency by 113%; CPU rose 118%. Telemetry cost: ~56918 log entries / 10k req; ~66712 spans / 10k req.
- **Full OpenTelemetry Pipeline**: increased mean p95 latency by 433%; CPU rose 144%. Telemetry cost: ~56961 log entries / 10k req; ~66728 spans / 10k req; Collector adds 18% CPU.

## Threats to Validity

- Load profile is the short baseline scenario (few VUs, ~8s per run); absolute latencies are small, so a single slow run can dominate a mode's mean. The `p95 var %` column quantifies this run-to-run spread.
- All runs share one machine and Docker resource envelope, but were captured at different times; background load on the host can shift CPU and memory readings.
- Memory is the peak sampled container memory, not steady-state; at this load it is dominated by runtime/heap baselines rather than telemetry buffers.
- Overhead percentages are most meaningful for the heavier modes (logs, traces, full pipeline). Near-baseline modes can show small negative overhead purely from noise; this is expected and is not evidence that instrumentation is free.

## Reproduce

```bash
pnpm overhead:report
```

Re-run the per-mode experiments (`pnpm baseline:run`, `pnpm metrics:run`, ...) first to refresh the inputs, then re-run the aggregation above.
