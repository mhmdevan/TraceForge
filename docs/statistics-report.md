# Statistical Analysis — Observability Overhead

Generated at: 2026-06-05T15:10:42.983Z

> **⚠️ Underpowered sample (N=3 per mode).** This pipeline produces publication-grade statistics, but the current per-mode results were captured with only 3 repetitions on a micro-benchmark load. The significance tests below are therefore **indicative, not conclusive**. For an ISI/journal submission, re-run each mode **≥10 times in randomized order** under a realistic steady-state load, then re-run `pnpm stats:report`. The numbers will populate identically — only the statistical power improves.

## Method

Latency and resource distributions are non-normal, so the analysis is non-parametric throughout:

- **Central tendency / spread:** median and IQR.
- **Uncertainty:** bootstrap **95% CI of the median** (5,000 resamples, seeded).
- **Across modes:** Kruskal–Wallis H test.
- **Vs baseline:** two-sided Mann–Whitney U with continuity + tie correction.
- **Effect size:** Cliff's delta (negligible/small/medium/large).
- **Decision aid:** a mode whose 95% CI does **not** overlap the baseline's CI differs from baseline with high confidence.

## p50 latency (ms)

| Mode | N | Median [95% CI] | IQR | CV% |
| --- | ---: | --- | ---: | ---: |
| Baseline (none) | 3 | 3.59 [3.16, 3.71] | 0.28 | 8.4 |
| Metrics | 3 | 3.29 [3.08, 3.51] | 0.22 | 6.7 |
| Metrics + Logs | 3 | 5.83 [5.41, 7.41] | 1.00 | 17.0 |
| Metrics + Logs + Traces | 3 | 5.41 [4.67, 6.83] | 1.08 | 19.5 |
| Full OpenTelemetry | 3 | 8.95 [7.35, 10.94] | 1.80 | 19.8 |

Kruskal–Wallis across modes: H = 12.23, df = 4, p = 0.016.

| Mode vs baseline | Median overhead | Mann–Whitney p | Cliff's δ | CI overlaps baseline? |
| --- | ---: | ---: | --- | --- |
| Metrics | -8.4% | 0.383 | -0.56 (large) | yes |
| Metrics + Logs | +62.4% | 0.081 | 1.00 (large) | **no** |
| Metrics + Logs + Traces | +50.6% | 0.081 | 1.00 (large) | **no** |
| Full OpenTelemetry | +149.4% | 0.081 | 1.00 (large) | **no** |

## p95 latency (ms)

| Mode | N | Median [95% CI] | IQR | CV% |
| --- | ---: | --- | ---: | ---: |
| Baseline (none) | 3 | 13.04 [11.54, 14.00] | 1.23 | 9.6 |
| Metrics | 3 | 10.01 [9.53, 12.92] | 1.69 | 16.9 |
| Metrics + Logs | 3 | 46.94 [38.20, 95.98] | 28.89 | 51.6 |
| Metrics + Logs + Traces | 3 | 25.36 [22.58, 34.22] | 5.82 | 22.2 |
| Full OpenTelemetry | 3 | 76.35 [48.79, 80.28] | 15.74 | 25.1 |

Kruskal–Wallis across modes: H = 12.63, df = 4, p = 0.013.

| Mode vs baseline | Median overhead | Mann–Whitney p | Cliff's δ | CI overlaps baseline? |
| --- | ---: | ---: | --- | --- |
| Metrics | -23.2% | 0.190 | -0.78 (large) | yes |
| Metrics + Logs | +260.1% | 0.081 | 1.00 (large) | **no** |
| Metrics + Logs + Traces | +94.5% | 0.081 | 1.00 (large) | **no** |
| Full OpenTelemetry | +485.7% | 0.081 | 1.00 (large) | **no** |

## p99 latency (ms)

| Mode | N | Median [95% CI] | IQR | CV% |
| --- | ---: | --- | ---: | ---: |
| Baseline (none) | 3 | 35.59 [34.86, 37.92] | 1.53 | 4.4 |
| Metrics | 3 | 18.94 [17.58, 20.82] | 1.62 | 8.5 |
| Metrics + Logs | 3 | 109.38 [91.33, 198.50] | 53.58 | 43.1 |
| Metrics + Logs + Traces | 3 | 101.26 [54.98, 134.73] | 39.88 | 41.3 |
| Full OpenTelemetry | 3 | 182.43 [151.84, 325.23] | 86.70 | 42.1 |

Kruskal–Wallis across modes: H = 12.23, df = 4, p = 0.016.

| Mode vs baseline | Median overhead | Mann–Whitney p | Cliff's δ | CI overlaps baseline? |
| --- | ---: | ---: | --- | --- |
| Metrics | -46.8% | 0.081 | -1.00 (large) | **no** |
| Metrics + Logs | +207.3% | 0.081 | 1.00 (large) | **no** |
| Metrics + Logs + Traces | +184.5% | 0.081 | 1.00 (large) | **no** |
| Full OpenTelemetry | +412.6% | 0.081 | 1.00 (large) | **no** |

## Docker CPU (%)

| Mode | N | Median [95% CI] | IQR | CV% |
| --- | ---: | --- | ---: | ---: |
| Baseline (none) | 3 | 5.99 [5.85, 6.31] | 0.23 | 3.9 |
| Metrics | 3 | 4.73 [4.57, 5.25] | 0.34 | 7.3 |
| Metrics + Logs | 3 | 15.32 [13.51, 18.10] | 2.30 | 14.8 |
| Metrics + Logs + Traces | 3 | 13.58 [10.83, 15.13] | 2.15 | 16.5 |
| Full OpenTelemetry | 3 | 15.10 [12.89, 16.23] | 1.67 | 11.5 |

Kruskal–Wallis across modes: H = 11.33, df = 4, p = 0.023.

| Mode vs baseline | Median overhead | Mann–Whitney p | Cliff's δ | CI overlaps baseline? |
| --- | ---: | ---: | --- | --- |
| Metrics | -21.0% | 0.081 | -1.00 (large) | **no** |
| Metrics + Logs | +155.9% | 0.081 | 1.00 (large) | **no** |
| Metrics + Logs + Traces | +126.9% | 0.081 | 1.00 (large) | **no** |
| Full OpenTelemetry | +152.3% | 0.081 | 1.00 (large) | **no** |

## Max memory (MiB)

| Mode | N | Median [95% CI] | IQR | CV% |
| --- | ---: | --- | ---: | ---: |
| Baseline (none) | 3 | 170.70 [170.40, 172.20] | 0.90 | 0.6 |
| Metrics | 3 | 191.70 [191.70, 191.70] | 0.00 | 0.0 |
| Metrics + Logs | 3 | 135.40 [135.30, 135.50] | 0.10 | 0.1 |
| Metrics + Logs + Traces | 3 | 146.00 [141.40, 149.20] | 3.90 | 2.7 |
| Full OpenTelemetry | 3 | 138.60 [128.20, 140.00] | 5.90 | 4.8 |

Kruskal–Wallis across modes: H = 12.99, df = 4, p = 0.011.

| Mode vs baseline | Median overhead | Mann–Whitney p | Cliff's δ | CI overlaps baseline? |
| --- | ---: | ---: | --- | --- |
| Metrics | +12.3% | 0.064 | 1.00 (large) | **no** |
| Metrics + Logs | -20.7% | 0.081 | -1.00 (large) | **no** |
| Metrics + Logs + Traces | -14.5% | 0.081 | -1.00 (large) | **no** |
| Full OpenTelemetry | -18.8% | 0.081 | -1.00 (large) | **no** |

## Figures

![stats-p95-boxplot.svg](../results/charts/stats-p95-boxplot.svg)

![stats-cpu-boxplot.svg](../results/charts/stats-cpu-boxplot.svg)

![stats-memory-boxplot.svg](../results/charts/stats-memory-boxplot.svg)

## How to read this

- A p-value alone is not enough: pair it with Cliff's δ (effect size) and the CI-overlap column. A real, meaningful difference shows a small p, a non-negligible δ, and non-overlapping CIs.
- With small N, even large observed differences can have wide CIs and unstable p-values — which is exactly why the sample size must grow before publication.

## Reproduce

```bash
pnpm stats:report
```

Deterministic given the seed (bootstrap RNG is seeded). Inputs are the per-mode `results/processed/*-summary.csv` files; re-run the experiments to refresh them.
