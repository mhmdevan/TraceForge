# Metrics + Logs

Phase 5 measures the added cost and debugging value of structured logs on top of
Prometheus metrics.

## Mode

```text
OBS_MODE=metrics_logs
```

In this mode:

- Prometheus metrics remain enabled.
- Every service writes structured JSON logs.
- Every request gets a `correlation_id`.
- `x-correlation-id` propagates through downstream HTTP calls.
- `x-correlation-id` propagates through RabbitMQ message headers.
- Loki receives logs through the shared logger's push sink.
- Grafana provisions the `TraceForge Logs` dashboard.
- Tracing and the OpenTelemetry Collector remain disabled.

## Run

```bash
OBS_MODE=metrics_logs docker compose -f infra/docker/compose/docker-compose.base.yml --profile metrics --profile logs up --build -d
pnpm migrate:postgres
pnpm metrics-logs:run
```

## Outputs

- `results/raw/metrics-logs-*/k6-summary-run-*.json`
- `results/raw/metrics-logs-*/docker-stats-run-*.json`
- `results/raw/metrics-logs-*/loki-log-volume.json`
- `results/processed/metrics-logs-summary.csv`
- `results/reports/metrics-logs-summary.md`

## Measurement

The phase 5 report compares metrics+logs against the metrics-only CSV. This isolates
the overhead introduced by structured logs and Loki ingestion.

The report also records:

- total Loki log entries during the measured k6 window
- log entries per 10,000 HTTP requests
- average sampled log entry size
- estimated log storage bytes
- log entries grouped by service
