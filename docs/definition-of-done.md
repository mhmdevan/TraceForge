# Definition of Done

## Phase 1

- All four base services build successfully.
- Every base service exposes `GET /health`.
- Shared packages compile under TypeScript strict mode.
- Unit tests cover service health endpoints and shared primitives.
- Dockerfiles exist for all services.
- Base Docker Compose defines the four services and their health checks.
- CI runs lint, tests, and build.

## Verification Commands

```bash
pnpm lint
pnpm test
pnpm typecheck
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

## Phase 2

- `POST /transactions` exists on the API Gateway.
- `GET /transactions/:id` exists on the API Gateway.
- `GET /users/:userId/transactions` exists on the API Gateway.
- Transaction records are stored in PostgreSQL.
- Transaction reads use Redis as a cache.
- The transaction service calls the payment service.
- The transaction service publishes `transaction.created` events.
- The worker service consumes `transaction.created` events.
- Consumed events are persisted in `transaction_events`.
- A full-flow e2e test exists and runs with `pnpm test:e2e`.

## Phase 3

- `OBS_MODE=none` is the baseline mode.
- Nest framework logs and structured application logs are disabled in baseline mode.
- Metrics, tracing, and OpenTelemetry Collector are not active.
- Smoke check runs before baseline measurement.
- Baseline load test runs 3 times.
- Docker stats are collected during every baseline run.
- Raw k6 summaries and Docker stats are stored under `results/raw`.
- Processed CSV is written to `results/processed/baseline-summary.csv`.
- Baseline report is written to `results/reports/baseline-summary.md`.
- Mean and standard deviation for p95 latency are calculated.

## Phase 4

- `OBS_MODE=metrics` enables Prometheus metrics without structured logs or traces.
- Every service exposes `GET /metrics`.
- `http_requests_total`, `http_request_duration_seconds`, and `http_errors_total`
  are available in every service.
- Transaction Service records DB, Redis, and RabbitMQ publish durations.
- Worker Service records DB and RabbitMQ consume durations.
- Prometheus scrapes all four services successfully.
- Grafana provisions a dashboard for RPS, p95 latency, error rate, CPU, and memory.
- Metrics-only load test runs 3 times.
- Metrics-only report calculates p95, CPU, and memory overhead against baseline.

## Phase 5

- `OBS_MODE=metrics_logs` enables metrics plus structured JSON application logs.
- `OBS_MODE=metrics` still keeps structured application logs disabled.
- All service-generated logs are JSON objects.
- Request logs include `correlation_id`, route, HTTP method, status code, and duration.
- Error logs are emitted for failed HTTP requests and failed RabbitMQ messages.
- Business event logs are emitted for transaction creation, payment authorization,
  RabbitMQ publish, and RabbitMQ consume.
- `x-correlation-id` propagates from API Gateway to Transaction Service and Payment
  Service.
- `x-correlation-id` propagates through RabbitMQ message headers to Worker Service.
- Loki receives logs for all four services.
- Grafana provisions a Loki datasource and a `TraceForge Logs` dashboard.
- Log search by correlation ID works through Loki.
- Metrics+logs load test runs 3 times.
- Metrics+logs report calculates p95, CPU, and memory overhead against metrics-only.
- Metrics+logs report records log entries per 10,000 requests and estimated log
  storage bytes.

## Phase 6

- `OBS_MODE=metrics_logs_traces` enables metrics, structured logs, and distributed
  traces.
- Services export OTLP traces to Jaeger.
- Request logs include `trace_id` when a trace is active.
- Trace context propagates from API Gateway to Transaction Service and Payment
  Service over HTTP.
- Trace context propagates from Transaction Service to Worker Service through
  RabbitMQ message headers.
- A full transaction flow appears as one trace in Jaeger.
- HTTP, PostgreSQL, Redis, RabbitMQ publish, RabbitMQ consume, and payment
  authorization appear as spans.
- Trace lookup by `trace_id` works from Loki logs to Jaeger.
- The slow payment scenario appears in the `payment.authorize` span waterfall.
- Metrics+logs+traces load test runs 3 times.
- Metrics+logs+traces report calculates p95, CPU, and memory overhead against
  metrics+logs.
- Metrics+logs+traces report records traces and spans per 10,000 requests.

## Phase 7

- `OBS_MODE=otel_full` enables the OpenTelemetry Collector.
- Services export traces to the Collector over OTLP.
- Services export structured logs to the Collector over OTLP.
- The Collector scrapes service metrics through its Prometheus receiver.
- The Collector routes traces to Jaeger.
- The Collector routes logs to Loki.
- The Collector exposes metrics for Prometheus on port `8889`.
- Prometheus scrapes Collector self metrics on port `8888`.
- Grafana provisions the `TraceForge Full OTel` dashboard.
- Prometheus loads at least three alert rules.
- Trace lookup by `trace_id` works from Collector-routed Loki logs to Jaeger.
- Full OTel load test runs 3 times.
- Full OTel report calculates p95, CPU, and memory overhead against
  metrics+logs+traces.
- Full OTel report records OpenTelemetry Collector CPU and memory.
