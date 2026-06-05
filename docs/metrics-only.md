# Metrics Only

Phase 4 measures the cost of Prometheus metrics without structured logs, traces,
Loki, Jaeger, Tempo, or the OpenTelemetry Collector.

## Mode

```bash
OBS_MODE=metrics
```

In this mode:

- every service exposes `/metrics`;
- HTTP request counts, durations, and errors are recorded;
- Transaction Service records DB, Redis, and RabbitMQ publish durations;
- Worker Service records DB and RabbitMQ consume durations;
- Prometheus scrapes all four services;
- Grafana loads the `TraceForge Metrics` dashboard.

## Command

```bash
OBS_MODE=metrics docker compose -f infra/docker/compose/docker-compose.base.yml --profile metrics up --build -d
pnpm migrate:postgres
pnpm metrics:run
```

## Outputs

- `results/raw/metrics-only-*/k6-summary-run-*.json`
- `results/raw/metrics-only-*/docker-stats-run-*.json`
- `results/processed/metrics-only-summary.csv`
- `results/reports/metrics-only-summary.md`
