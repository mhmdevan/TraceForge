# Latency vs Throughput Sweep

Generated at: 2026-06-05T18:39:59.676Z

## Method

Each mode's stack is brought up once and driven at an increasing series of offered arrival rates (20, 40, 80, 160 iterations/s, i.e. ~60, 120, 240, 480 req/s), with 3 repetitions of 15s per rate (median reported). This shows the load regime where the modes diverge and where each saturates — the load-robust complement to the fixed-rate campaign in `statistics-load-report.md`.

### Baseline

| Offered req/s | Achieved req/s | p50 (ms) | p95 (ms) | Error % | CPU % |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 60 | 60 | 2.0 | 7.4 | 0.0 | 5.6 |
| 120 | 120 | 1.5 | 6.4 | 0.0 | 7.1 |
| 240 | 240 | 1.2 | 6.6 | 0.0 | 10.2 |
| 480 | 480 | 1.2 | 5.5 | 0.0 | 15.3 |

### Metrics + Logs

| Offered req/s | Achieved req/s | p50 (ms) | p95 (ms) | Error % | CPU % |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 60 | 60 | 3.1 | 10.3 | 0.0 | 7.0 |
| 120 | 120 | 3.0 | 22.3 | 0.0 | 10.5 |
| 240 | 240 | 5.2 | 103.8 | 0.0 | 21.3 |
| 480 | 364 | 563.1 | 5145.3 | 0.0 | 30.0 |

### Full OpenTelemetry

| Offered req/s | Achieved req/s | p50 (ms) | p95 (ms) | Error % | CPU % |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 60 | 60 | 5.2 | 33.8 | 0.0 | 9.1 |
| 120 | 120 | 8.5 | 145.1 | 0.0 | 17.0 |
| 240 | 195 | 581.2 | 6687.0 | 0.0 | 24.8 |
| 480 | 221 | 603.7 | 16088.2 | 0.0 | 24.8 |

## Figures

![sweep-latency-vs-load.svg](../results/charts/sweep-latency-vs-load.svg)

![sweep-throughput.svg](../results/charts/sweep-throughput.svg)

## How to read

- **Latency-vs-load:** at low offered load all modes sit close together (the small absolute baseline makes relative overhead look large but costs little in milliseconds); as load rises the instrumented curves climb and bend upward sooner.
- **Saturation:** where an _achieved_ curve falls below the diagonal (achieved < offered), that mode can no longer keep up — its knee. More-instrumented modes reach the knee at a lower offered rate.

## Threats to validity

- **Co-located load generator:** k6 runs on the same host as the system under test, so the highest offered rates include some load-generator CPU contention; treat the absolute high-load latencies as an upper bound.
- **Single machine, point-in-time:** see `reproducibility.md` for the recorded environment.

## Reproduce

```bash
pnpm sweep:run   # SWEEP_MODES, SWEEP_RATES, SWEEP_REPS, DURATION are configurable
```
