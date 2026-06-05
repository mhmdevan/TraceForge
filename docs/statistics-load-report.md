# Statistical Analysis — Observability Overhead

Generated at: 2026-06-05T17:23:15.990Z

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
| Baseline (none) | 10 | 1.72 [1.64, 1.91] | 0.20 | 18.6 |
| Metrics | 10 | 2.71 [1.64, 5.28] | 2.69 | 222.7 |
| Metrics + Logs | 10 | 4.77 [4.10, 16.92] | 6.25 | 248.6 |
| Metrics + Logs + Traces | 10 | 2.89 [2.49, 4.55] | 1.75 | 34.0 |
| Full OpenTelemetry | 10 | 3.33 [2.68, 4.05] | 1.04 | 24.2 |

Kruskal–Wallis across modes: H = 23.13, df = 4, p = <0.001.

| Mode vs baseline | Median overhead | Mann–Whitney p | Cliff's δ | CI overlaps baseline? |
| --- | ---: | ---: | --- | --- |
| Metrics | +58.1% | 0.307 | 0.28 (small) | yes |
| Metrics + Logs | +177.4% | <0.001 | 1.00 (large) | **no** |
| Metrics + Logs + Traces | +68.5% | <0.001 | 0.92 (large) | **no** |
| Full OpenTelemetry | +94.1% | <0.001 | 0.96 (large) | **no** |

## p95 latency (ms)

| Mode | N | Median [95% CI] | IQR | CV% |
| --- | ---: | --- | ---: | ---: |
| Baseline (none) | 10 | 5.45 [4.99, 11.64] | 1.43 | 154.1 |
| Metrics | 10 | 35.29 [5.76, 297.14] | 249.73 | 222.6 |
| Metrics + Logs | 10 | 85.79 [19.65, 413.14] | 306.17 | 234.7 |
| Metrics + Logs + Traces | 10 | 12.22 [10.05, 58.62] | 30.90 | 108.3 |
| Full OpenTelemetry | 10 | 13.75 [10.55, 39.91] | 21.25 | 118.6 |

Kruskal–Wallis across modes: H = 16.17, df = 4, p = 0.003.

| Mode vs baseline | Median overhead | Mann–Whitney p | Cliff's δ | CI overlaps baseline? |
| --- | ---: | ---: | --- | --- |
| Metrics | +547.3% | 0.054 | 0.52 (large) | yes |
| Metrics + Logs | +1473.3% | <0.001 | 0.90 (large) | **no** |
| Metrics + Logs + Traces | +124.1% | 0.007 | 0.72 (large) | yes |
| Full OpenTelemetry | +152.2% | 0.014 | 0.66 (large) | yes |

## p99 latency (ms)

| Mode | N | Median [95% CI] | IQR | CV% |
| --- | ---: | --- | ---: | ---: |
| Baseline (none) | 10 | 9.57 [8.58, 28.47] | 7.27 | 238.9 |
| Metrics | 10 | 319.47 [10.13, 893.76] | 766.27 | 178.6 |
| Metrics + Logs | 10 | 540.04 [66.47, 2160] | 2058 | 150.8 |
| Metrics + Logs + Traces | 10 | 46.51 [20.04, 247.24] | 182.22 | 112.6 |
| Full OpenTelemetry | 10 | 47.72 [26.57, 202.67] | 116.16 | 121.6 |

Kruskal–Wallis across modes: H = 15.60, df = 4, p = 0.004.

| Mode vs baseline | Median overhead | Mann–Whitney p | Cliff's δ | CI overlaps baseline? |
| --- | ---: | ---: | --- | --- |
| Metrics | +3239.7% | 0.031 | 0.58 (large) | yes |
| Metrics + Logs | +5545.4% | 0.001 | 0.88 (large) | **no** |
| Metrics + Logs + Traces | +386.2% | 0.009 | 0.70 (large) | yes |
| Full OpenTelemetry | +398.9% | 0.014 | 0.66 (large) | yes |

## Docker CPU (%)

| Mode | N | Median [95% CI] | IQR | CV% |
| --- | ---: | --- | ---: | ---: |
| Baseline (none) | 10 | 5.62 [5.26, 7.16] | 0.89 | 26.4 |
| Metrics | 10 | 8.30 [5.18, 13.57] | 6.90 | 67.0 |
| Metrics + Logs | 10 | 14.85 [13.69, 19.59] | 4.77 | 30.0 |
| Metrics + Logs + Traces | 10 | 8.94 [8.23, 13.24] | 4.22 | 25.3 |
| Full OpenTelemetry | 10 | 8.50 [7.15, 9.64] | 1.61 | 17.4 |

Kruskal–Wallis across modes: H = 24.21, df = 4, p = <0.001.

| Mode vs baseline | Median overhead | Mann–Whitney p | Cliff's δ | CI overlaps baseline? |
| --- | ---: | ---: | --- | --- |
| Metrics | +47.7% | 0.345 | 0.26 (small) | yes |
| Metrics + Logs | +164.5% | <0.001 | 1.00 (large) | **no** |
| Metrics + Logs + Traces | +59.1% | 0.003 | 0.80 (large) | **no** |
| Full OpenTelemetry | +51.4% | 0.011 | 0.68 (large) | yes |

## Max memory (MiB)

| Mode | N | Median [95% CI] | IQR | CV% |
| --- | ---: | --- | ---: | ---: |
| Baseline (none) | 10 | 139.15 [138.60, 163.25] | 0.95 | 14.1 |
| Metrics | 10 | 184.90 [140.60, 187.10] | 35.53 | 13.1 |
| Metrics + Logs | 10 | 214.25 [196.55, 241.40] | 24.37 | 17.4 |
| Metrics + Logs + Traces | 10 | 313.55 [186.00, 456.00] | 235.72 | 41.8 |
| Full OpenTelemetry | 10 | 291.80 [245.80, 374.35] | 76.23 | 28.5 |

Kruskal–Wallis across modes: H = 30.04, df = 4, p = <0.001.

| Mode vs baseline | Median overhead | Mann–Whitney p | Cliff's δ | CI overlaps baseline? |
| --- | ---: | ---: | --- | --- |
| Metrics | +32.9% | 0.058 | 0.51 (large) | yes |
| Metrics + Logs | +54.0% | <0.001 | 1.00 (large) | **no** |
| Metrics + Logs + Traces | +125.3% | 0.001 | 0.88 (large) | **no** |
| Full OpenTelemetry | +109.7% | <0.001 | 0.96 (large) | **no** |

## Figures

![stats-load-p95-boxplot.svg](../results/charts/stats-load-p95-boxplot.svg)

![stats-load-cpu-boxplot.svg](../results/charts/stats-load-cpu-boxplot.svg)

![stats-load-memory-boxplot.svg](../results/charts/stats-load-memory-boxplot.svg)

## How to read this

- A p-value alone is not enough: pair it with Cliff's δ (effect size) and the CI-overlap column. A real, meaningful difference shows a small p, a non-negligible δ, and non-overlapping CIs.
- With small N, even large observed differences can have wide CIs and unstable p-values — which is exactly why the sample size must grow before publication.

## Reproduce

```bash
pnpm stats:report
```

Deterministic given the seed (bootstrap RNG is seeded). Inputs are the per-mode `results/processed/*-summary.csv` files; re-run the experiments to refresh them.
