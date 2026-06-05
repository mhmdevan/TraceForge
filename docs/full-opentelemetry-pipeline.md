# Full OpenTelemetry Pipeline

Phase 7 moves telemetry routing into an OpenTelemetry Collector.

```bash
OBS_MODE=otel_full
```

## Runtime Behavior

- Services export traces to the Collector over OTLP/HTTP.
- Services export structured logs to the Collector over OTLP/HTTP.
- The Collector scrapes service Prometheus metrics through its Prometheus receiver.
- The Collector exports traces to Jaeger.
- The Collector exports logs to Loki.
- The Collector exports metrics on port `8889` for Prometheus.
- Prometheus also scrapes Collector self metrics on port `8888`.

The direct service `/metrics` endpoints remain available. In full OTel mode, the
Collector metrics pipeline is the measured path for the unified telemetry pipeline.

## Run

```bash
OBS_MODE=otel_full \
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
docker compose -f infra/docker/compose/docker-compose.base.yml --profile metrics --profile logs --profile traces --profile otel up --build -d

pnpm migrate:postgres
pnpm otel-full:run
```

## Pipelines

- `traces`: OTLP receiver -> memory limiter -> resource attributes -> batch -> Jaeger
- `logs`: OTLP receiver -> memory limiter -> resource attributes -> Loki labels -> batch -> Loki
- `metrics`: OTLP + Prometheus receivers -> memory limiter -> resource attributes -> batch -> Prometheus exporter

## Alerts

Prometheus loads three alert rules:

- `TraceForgeHighP95Latency`
- `TraceForgeHttpErrors`
- `TraceForgeOtelCollectorDown`

## Outputs

- `results/raw/otel-full-*/k6-summary-run-*.json`
- `results/raw/otel-full-*/docker-stats-run-*.json`
- `results/raw/otel-full-*/loki-log-volume.json`
- `results/raw/otel-full-*/jaeger-trace-volume.json`
- `results/raw/otel-full-*/jaeger-trace-sample.json`
- `results/processed/otel-full-summary.csv`
- `results/reports/otel-full-summary.md`

## Measurement

The runner compares p95 latency, Docker CPU, and memory against the
metrics+logs+traces CSV. It also records OpenTelemetry Collector CPU and memory so
collector overhead is visible in the report.
