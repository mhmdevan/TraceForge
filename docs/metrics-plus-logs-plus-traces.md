# Metrics + Logs + Traces

Phase 6 enables distributed tracing on top of the existing Prometheus metrics and
structured Loki logs.

```bash
OBS_MODE=metrics_logs_traces
```

## Runtime Behavior

- Services export OTLP traces directly to Jaeger.
- The shared logger adds the active `trace_id` to JSON log entries.
- HTTP calls propagate W3C trace context through `traceparent`.
- RabbitMQ messages carry trace context in message headers.
- PostgreSQL, Redis, RabbitMQ publish/consume, and payment authorization create
  spans in the same transaction trace.

The `slow-payment` scenario is triggered by a transaction description of
`slow-payment`. The transaction service forwards an internal delay header to the
payment service, and the delay appears in the `payment.authorize` span.

## Run

```bash
OBS_MODE=metrics_logs_traces docker compose -f infra/docker/compose/docker-compose.base.yml --profile metrics --profile logs --profile traces up --build -d
pnpm migrate:postgres
pnpm metrics-logs-traces:run
```

## Outputs

- `results/raw/metrics-logs-traces-*/k6-summary-run-*.json`
- `results/raw/metrics-logs-traces-*/docker-stats-run-*.json`
- `results/raw/metrics-logs-traces-*/loki-log-volume.json`
- `results/raw/metrics-logs-traces-*/jaeger-trace-volume.json`
- `results/raw/metrics-logs-traces-*/jaeger-trace-sample.json`
- `results/processed/metrics-logs-traces-summary.csv`
- `results/reports/metrics-logs-traces-summary.md`

## Measurement

The runner compares p95 latency, Docker CPU, and memory against the metrics+logs
CSV. It also records trace count, span count, complete trace rate, trace volume per
10,000 requests, and span volume per 10,000 requests.
