# 5-Minute Demo

A short, scripted path that shows the whole value of TraceForge without touching the
experiment harness. Run from the repository root. Assumes Docker and a built stack
(`pnpm install && pnpm build`, then `docker compose ... build` once).

```bash
COMPOSE="docker compose -f infra/docker/compose/docker-compose.base.yml"
```

## 1. Start the fully observable stack (~1 min)

```bash
OBS_MODE=otel_full OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
  $COMPOSE --profile metrics --profile logs --profile traces --profile otel up -d
$COMPOSE ps          # wait until the core services are "healthy"
```

| UI                               | URL                    |
| -------------------------------- | ---------------------- |
| API Gateway                      | http://localhost:3000  |
| Prometheus (metrics + alerts)    | http://localhost:9090  |
| Grafana (dashboards / Loki logs) | http://localhost:3004  |
| Jaeger (traces)                  | http://localhost:16686 |

## 2. Create a transaction (the happy path)

```bash
curl -s -X POST http://localhost:3000/transactions \
  -H 'content-type: application/json' \
  -d '{"userId":"demo-user","amount":42,"currency":"USD","description":"demo"}'
```

It returns `201` with a transaction id. Read it back and the user's history:

```bash
curl -s http://localhost:3000/transactions/<id>
curl -s http://localhost:3000/users/demo-user/transactions
```

## 3. Show the three pillars

- **Metrics** — open Prometheus → query `http_request_duration_seconds_count`, or
  `curl -s http://localhost:3000/metrics | head`.
- **Traces** — open Jaeger → service `api-gateway` → find the request and show the span
  tree crossing gateway → transaction → payment → worker.
- **Logs** — open Grafana → Explore → Loki → filter by the correlation id from the trace.

## 4. Break it on purpose

Re-create the payment service with a 30% error rate, then drive a little traffic:

```bash
PAYMENT_ERROR_RATE=0.3 $COMPOSE up -d payment-service

for i in $(seq 1 60); do
  curl -s -o /dev/null -X POST http://localhost:3000/transactions \
    -H 'content-type: application/json' \
    -d '{"userId":"demo-user","amount":10,"currency":"USD","description":"demo"}'
done
```

## 5. Show detection

- **Prometheus → Alerts** (http://localhost:9090/alerts): `TraceForgeHttpErrors` moves to
  **pending**, then **firing** (~1 min). This is the objective MTTD signal — the same one
  `pnpm mttd:run` times automatically.
- In **Jaeger**, the failed transactions show the error span; in **Loki**, the matching
  error logs. Without the metrics pipeline (baseline mode) none of this exists — the fault
  would be invisible.

## 6. Show a finished result

```bash
open docs/statistics-load-report.md        # RQ1: metrics free, logging dominant (N=10, CIs)
open results/charts/sweep-throughput.svg   # saturation: Full OTel caps ~220 req/s
open docs/mttd-report.md                    # RQ2: undetectable without metrics
```

## Tear down

```bash
$COMPOSE down --remove-orphans
```

> Talking point: this is the qualitative story; the quantitative, statistically-tested
> version is in `docs/manuscript.md` and `docs/claims-to-evidence.md`.
