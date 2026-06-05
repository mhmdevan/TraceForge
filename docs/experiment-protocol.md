# Experiment Protocol

Phase 1 does not run performance experiments. It prepares repeatable commands that
future phases can use as the baseline workflow:

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
docker compose -f infra/docker/compose/docker-compose.base.yml up --build
pnpm test:e2e
OBS_MODE=none pnpm baseline:run
OBS_MODE=metrics docker compose -f infra/docker/compose/docker-compose.base.yml --profile metrics up --build -d
pnpm metrics:run
OBS_MODE=metrics_logs docker compose -f infra/docker/compose/docker-compose.base.yml --profile metrics --profile logs up --build -d
pnpm metrics-logs:run
OBS_MODE=metrics_logs_traces docker compose -f infra/docker/compose/docker-compose.base.yml --profile metrics --profile logs --profile traces up --build -d
pnpm metrics-logs-traces:run
OBS_MODE=otel_full OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 docker compose -f infra/docker/compose/docker-compose.base.yml --profile metrics --profile logs --profile traces --profile otel up --build -d
pnpm otel-full:run
```

Every later experiment should record:

- Git commit hash
- Hardware and operating system details
- Docker version
- Observability mode
- Load profile
- Raw results path
- Processed results path

## Phase 3 Baseline Protocol

1. Start the base Docker Compose stack with `OBS_MODE=none`.
2. Apply PostgreSQL migrations.
3. Run `pnpm smoke:baseline`.
4. Run `pnpm baseline:run`.
5. Store raw k6 summaries and Docker stats under `results/raw`.
6. Store processed metrics under `results/processed`.
7. Store the summary report under `results/reports`.

## Phase 4 Metrics-Only Protocol

1. Start Docker Compose with `OBS_MODE=metrics` and `--profile metrics`.
2. Apply PostgreSQL migrations.
3. Run `pnpm smoke:metrics`.
4. Run `pnpm metrics:run`.
5. Confirm Prometheus reports all four service targets as up.
6. Store raw k6 summaries and Docker stats under `results/raw`.
7. Store metrics-only CSV under `results/processed/metrics-only-summary.csv`.
8. Store overhead report under `results/reports/metrics-only-summary.md`.

## Phase 5 Metrics+Logs Protocol

1. Start Docker Compose with `OBS_MODE=metrics_logs`, `--profile metrics`, and
   `--profile logs`.
2. Apply PostgreSQL migrations.
3. Run `pnpm smoke:metrics-logs`.
4. Confirm Loki is ready at `GET /ready`.
5. Confirm the smoke transaction's `x-correlation-id` appears in Loki for API Gateway,
   Transaction Service, Payment Service, and Worker Service.
6. Run `pnpm metrics-logs:run`.
7. Confirm Prometheus reports all four service targets as up.
8. Store raw k6 summaries, Docker stats, and Loki log-volume summary under
   `results/raw`.
9. Store metrics+logs CSV under `results/processed/metrics-logs-summary.csv`.
10. Store overhead and log-volume report under
    `results/reports/metrics-logs-summary.md`.

## Phase 6 Metrics+Logs+Traces Protocol

1. Start Docker Compose with `OBS_MODE=metrics_logs_traces`, `--profile metrics`,
   `--profile logs`, and `--profile traces`.
2. Apply PostgreSQL migrations.
3. Run `pnpm smoke:metrics-logs-traces`.
4. Confirm Jaeger is ready at `GET /api/services`.
5. Confirm a smoke transaction's `trace_id` appears in Loki logs.
6. Confirm the same `trace_id` can be opened through Jaeger trace lookup.
7. Confirm the trace includes API Gateway, Transaction Service, Payment Service, and
   Worker Service spans.
8. Confirm HTTP, PostgreSQL, Redis, RabbitMQ publish, and RabbitMQ consume spans are
   present.
9. Confirm the slow payment scenario is visible in the `payment.authorize` span.
10. Run `pnpm metrics-logs-traces:run`.
11. Store raw k6 summaries, Docker stats, Loki log-volume summary, Jaeger
    trace-volume summary, and Jaeger trace sample under `results/raw`.
12. Store metrics+logs+traces CSV under
    `results/processed/metrics-logs-traces-summary.csv`.
13. Store overhead, log-volume, and trace-volume report under
    `results/reports/metrics-logs-traces-summary.md`.

## Phase 7 Full OpenTelemetry Protocol

1. Start Docker Compose with `OBS_MODE=otel_full`,
   `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`, `--profile metrics`,
   `--profile logs`, `--profile traces`, and `--profile otel`.
2. Apply PostgreSQL migrations.
3. Run `pnpm smoke:otel-full`.
4. Confirm the OpenTelemetry Collector health endpoint is ready.
5. Confirm the Collector Prometheus exporter exposes service metrics.
6. Confirm Prometheus reports service, Collector exporter, and Collector self targets
   as up.
7. Confirm Prometheus loads the high latency, HTTP error, and Collector down alert
   rules.
8. Confirm a smoke transaction's `trace_id` appears in Loki after routing through the
   Collector.
9. Confirm the same `trace_id` can be opened through Jaeger trace lookup.
10. Run `pnpm otel-full:run`.
11. Store raw k6 summaries, Docker stats, Loki log-volume summary, Jaeger
    trace-volume summary, and Jaeger trace sample under `results/raw`.
12. Store full OTel CSV under `results/processed/otel-full-summary.csv`.
13. Store overhead, Collector resource, log-volume, and trace-volume report under
    `results/reports/otel-full-summary.md`.
