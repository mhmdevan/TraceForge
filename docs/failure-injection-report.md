# Failure Injection and Debuggability Report

Generated at: 2026-06-05T13:50:58.290Z

> **Illustrative example — NOT measured.** This report was generated from `experiments/failure-injection/observations.example.json` (status: `illustrative-example`). The numbers are placeholders that demonstrate the tooling. Record real runs following docs/failure-injection-protocol.md and set `status` to `measured` to replace them.

## Scenario Matrix

| ID | Scenario | Service | Expected symptom | Best tool | Inject with |
| --- | --- | --- | --- | --- | --- |
| F1 | Slow payment | payment-service | high latency | traces | `PAYMENT_MODE=slow` `PAYMENT_DELAY_MS=1000` |
| F2 | Payment 500 errors | payment-service | error rate spike | metrics + logs | `PAYMENT_ERROR_RATE=0.2` |
| F3 | Slow DB query | transaction-service | p95 increase | traces + DB metrics | `DB_SLOW_QUERY=true` `DB_SLOW_QUERY_DELAY_MS=500` |
| F4 | RabbitMQ consumer stopped | worker-service | queue lag | metrics | `WORKER_DISABLED=true` |
| F5 | Redis unavailable | transaction-service | cache miss + latency | logs + metrics | `REDIS_DISABLED=true` |
| F6 | Memory pressure | transaction-service | latency/error growth | metrics | `MEMORY_PRESSURE_ENABLED=true` `MEMORY_PRESSURE_MB=256` |

## Detection and Root-Cause Times

| Scenario | Mode | Detect (s) | Root cause (s) | Alert | Tools | Steps | Accuracy |
| --- | --- | ---: | ---: | --- | ---: | ---: | --- |
| F1 | Baseline | 70 | 540 | no | 2 | 9 | partial |
| F1 | Full OTel | 18 | 100 | yes | 2 | 3 | correct |
| F2 | Baseline | 40 | 390 | no | 2 | 7 | correct |
| F2 | Full OTel | 12 | 65 | yes | 2 | 3 | correct |
| F3 | Baseline | 90 | 780 | no | 2 | 11 | incorrect |
| F3 | Full OTel | 22 | 130 | yes | 3 | 4 | correct |
| F4 | Baseline | 180 | 900 | no | 2 | 8 | partial |
| F4 | Full OTel | 35 | 150 | yes | 2 | 4 | correct |
| F5 | Baseline | 80 | 720 | no | 2 | 10 | partial |
| F5 | Full OTel | 25 | 120 | no | 2 | 5 | correct |
| F6 | Baseline | 150 | 900 | no | 1 | 9 | partial |
| F6 | Full OTel | 40 | 180 | yes | 2 | 5 | correct |

## Debuggability Improvement (Full OTel vs Baseline)

| Scenario | Detect baseline (s) | Detect OTel (s) | Detect improvement | RC baseline (s) | RC OTel (s) | RC improvement |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| F1 | 70 | 18 | +74.3% | 540 | 100 | +81.5% |
| F2 | 40 | 12 | +70.0% | 390 | 65 | +83.3% |
| F3 | 90 | 22 | +75.6% | 780 | 130 | +83.3% |
| F4 | 180 | 35 | +80.6% | 900 | 150 | +83.3% |
| F5 | 80 | 25 | +68.8% | 720 | 120 | +83.3% |
| F6 | 150 | 40 | +73.3% | 900 | 180 | +80.0% |

- Mean detection-time improvement: +73.7%
- Mean root-cause-time improvement: +82.5%

## Charts

![detection-time.svg](../results/charts/detection-time.svg)

![root-cause-time.svg](../results/charts/root-cause-time.svg)

## Root-Cause Accuracy

| Mode | correct | partial | incorrect |
| --- | ---: | ---: | ---: |
| Baseline | 1 | 4 | 1 |
| Full OTel | 6 | 0 | 0 |

## Reproduce

```bash
pnpm failure:report
```

See docs/failure-injection-protocol.md for how to inject each fault and record the observations this report consumes.
