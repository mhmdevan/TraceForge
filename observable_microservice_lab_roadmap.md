# Observable Microservice Lab  
## Senior-Level Roadmap, Definition of Done, KPIs, Experiment Plan, and Research-Oriented Implementation Strategy

**Project working title:** `Observable Microservice Lab`  
**Academic title:** `Observability-Driven Performance Evaluation of Containerized Microservice Applications`  
**Research-oriented title:** `Evaluating Performance, Debuggability, and Operational Cost Trade-offs of Observability Instrumentation in Microservice Architectures`

---

## 0. Executive Summary

This project is not a simple CRUD application and it must not become one.

The goal is to build a controlled microservice-based experimental platform that allows repeatable measurement of how observability instrumentation, database indexing strategies, failure scenarios, and container orchestration choices affect:

- system latency,
- throughput,
- error rate,
- CPU and memory usage,
- network and disk overhead,
- log and trace volume,
- failure detection time,
- root-cause analysis time,
- operational complexity,
- and deployment reproducibility.

The core stack is:

```text
NestJS + TypeScript
PostgreSQL
Redis
RabbitMQ
Docker Compose
Docker Swarm
Optional Kubernetes
OpenTelemetry
Prometheus
Grafana
Loki
Jaeger or Tempo
k6
```

The project must support the following observability modes:

```text
OBS_MODE=none
OBS_MODE=metrics
OBS_MODE=metrics_logs
OBS_MODE=metrics_logs_traces
OBS_MODE=otel_full
```

The system must allow controlled experiments across these modes:

```text
Baseline without observability
Metrics only
Metrics + logs
Metrics + logs + traces
Full OpenTelemetry pipeline
```

The project must measure:

```text
performance overhead
debuggability improvement
failure detection time
resource cost
```

Future research phases must include:

```text
Indexing experiments
Observability overhead experiments
Failure injection
Docker Compose vs Docker Swarm vs optional Kubernetes comparison
SQL vs NoSQL indexing experiments
```

The important mindset:

> This is not an app-first project.  
> This is an experiment-first engineering platform.

If the project only demonstrates microservices, dashboards, and Docker Compose, it is weak.  
If it produces repeatable measurements, comparison tables, charts, and a research-style report, it becomes a serious academic and portfolio project.

---

## 1. Project Vision

### 1.1 Main Objective

Build a containerized microservice system that can be used to experimentally evaluate the trade-offs between observability depth and runtime cost.

The project should answer this core question:

> How much performance and resource overhead does observability introduce, and how much does it improve debugging and failure diagnosis in a microservice architecture?

This must be answered with measurements, not opinions.

### 1.2 Secondary Objectives

The project must also support future experimental extensions:

1. Evaluate PostgreSQL indexing strategies under load.
2. Evaluate MongoDB indexing strategies under similar query workloads.
3. Compare SQL and NoSQL indexing behavior from the service-level perspective.
4. Compare Docker Compose, Docker Swarm, and optional Kubernetes as deployment targets.
5. Inject failures and measure how observability changes failure detection and root-cause analysis time.
6. Produce datasets, experiment logs, and charts that can be reused in a research paper.

### 1.3 What Makes This Project Senior-Level?

A junior project usually proves that an application works.

A senior-level project proves that the system can be:

- deployed,
- observed,
- measured,
- stressed,
- broken intentionally,
- recovered,
- compared,
- and explained with evidence.

The senior-level value is not in having many services.  
The value is in controlled measurement and operational maturity.

---

## 2. Research Questions

The project must be designed around research questions from the beginning.

### RQ1 — Observability Overhead

```text
How does each level of observability instrumentation affect latency, throughput, error rate, CPU usage, memory usage, and network overhead in a containerized microservice system?
```

### RQ2 — Debuggability Improvement

```text
How much do metrics, logs, traces, and a full OpenTelemetry pipeline reduce failure detection time and root-cause analysis time?
```

### RQ3 — Telemetry Depth vs Operational Cost

```text
What is the trade-off between telemetry depth and operational cost in terms of log volume, trace volume, CPU usage, memory usage, and storage consumption?
```

### RQ4 — Database Indexing Under Observable Workloads

```text
How do different PostgreSQL and MongoDB indexing strategies affect service-level latency, query execution time, write overhead, and resource usage under concurrent workloads?
```

### RQ5 — Orchestration Model Comparison

```text
How do Docker Compose, Docker Swarm, and Kubernetes differ in deployment complexity, recovery behavior, scaling behavior, observability integration, and resource overhead?
```

---

## 3. Research Hypotheses

### H1 — Observability Adds Measurable Runtime Overhead

```text
Adding metrics, logs, traces, and a full OpenTelemetry pipeline increases latency, CPU usage, memory usage, network traffic, and telemetry storage volume compared to a baseline system without observability.
```

### H2 — Observability Improves Debuggability

```text
Although observability increases runtime overhead, it significantly reduces failure detection time and root-cause analysis time.
```

### H3 — Tracing Is More Valuable in Multi-Service Failures

```text
Distributed tracing provides greater debugging benefit than metrics or logs alone when the fault crosses service boundaries.
```

### H4 — Indexing Improves Reads but Can Penalize Writes

```text
Database indexes reduce read/query latency for specific access patterns, but can increase write latency, storage usage, and maintenance cost.
```

### H5 — Orchestration Complexity Has Operational Trade-Offs

```text
Docker Compose provides the simplest local reproducibility, Docker Swarm provides lightweight orchestration, and Kubernetes provides stronger scaling and recovery primitives at the cost of higher configuration and operational complexity.
```

---

## 4. System Architecture

### 4.1 Initial MVP Architecture

The first version must be small enough to finish but realistic enough to measure.

```text
Client / k6
   |
   v
API Gateway
   |
   v
Transaction Service
   |
   +--> PostgreSQL
   |
   +--> Redis
   |
   +--> Payment Service
   |
   +--> RabbitMQ
             |
             v
        Worker Service
```

### 4.2 Full Target Architecture

```text
Client / k6 / Test Runner
   |
   v
API Gateway
   |
   +--> User Service
   |
   +--> Transaction Service
   |        |
   |        +--> PostgreSQL
   |        +--> Redis
   |        +--> RabbitMQ
   |
   +--> Payment Service
   |
   +--> Risk Service
   |
   +--> Notification Service
   |
   +--> Worker Service
            |
            +--> RabbitMQ
            +--> PostgreSQL
            +--> Redis
```

### 4.3 Observability Architecture

```text
Microservices
   |
   +--> Prometheus metrics endpoint
   |
   +--> JSON structured logs
   |
   +--> OpenTelemetry SDK
            |
            v
      OpenTelemetry Collector
            |
            +--> Prometheus
            +--> Loki
            +--> Jaeger / Tempo
            +--> Grafana
```

### 4.4 Deployment Architecture

The project must support three deployment targets:

```text
Level 1: Docker Compose
Level 2: Docker Swarm
Level 3: Kubernetes, optional but recommended for challenge mode
```

The mandatory target is Docker Compose.  
Docker Swarm is strongly recommended.  
Kubernetes is optional, but if implemented, it should be treated as a separate research phase, not as a dependency for the MVP.

---

## 5. Domain Model

The domain should be transaction-oriented because it naturally supports:

- write operations,
- read-heavy queries,
- asynchronous events,
- payment simulation,
- failure injection,
- indexing experiments,
- load testing,
- and future blockchain-like behavioral analysis.

### 5.1 Core Entities

```text
User
Wallet
Transaction
PaymentAttempt
TransactionEvent
RiskScore
Notification
```

### 5.2 PostgreSQL Tables

```sql
users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

wallets (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

transactions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  amount NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

payment_attempts (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

transaction_events (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.3 Future MongoDB Collection

For the NoSQL indexing phase:

```json
{
  "_id": "uuid",
  "userId": "uuid",
  "walletId": "uuid",
  "amount": 150.50,
  "currency": "USD",
  "status": "COMPLETED",
  "type": "TRANSFER",
  "createdAt": "2026-05-28T12:00:00Z",
  "updatedAt": "2026-05-28T12:00:00Z",
  "metadata": {
    "country": "FI",
    "device": "web",
    "riskLevel": "low"
  }
}
```

---

## 6. Service Responsibilities

### 6.1 API Gateway

Responsibilities:

- expose public HTTP API,
- validate incoming requests,
- generate or forward correlation IDs,
- route requests to internal services,
- expose gateway metrics,
- propagate trace context,
- provide basic rate limiting if needed.

Endpoints:

```text
POST /transactions
GET /transactions/:id
GET /users/:userId/transactions
GET /health
GET /metrics
```

### 6.2 Transaction Service

Responsibilities:

- create transactions,
- read transactions,
- store transaction data in PostgreSQL,
- use Redis cache for read path,
- publish transaction events to RabbitMQ,
- expose database latency metrics,
- expose business metrics.

Important metrics:

```text
transactions_created_total
transactions_failed_total
transaction_create_duration_seconds
transaction_read_duration_seconds
db_query_duration_seconds
redis_cache_hits_total
redis_cache_misses_total
rabbitmq_publish_duration_seconds
```

### 6.3 Payment Service

Responsibilities:

- simulate payment processing,
- support configurable delay,
- support configurable error rate,
- support failure injection,
- expose service latency and error metrics.

Failure injection configuration:

```text
PAYMENT_DELAY_MS=0
PAYMENT_ERROR_RATE=0.0
PAYMENT_TIMEOUT_RATE=0.0
PAYMENT_MODE=normal | slow | error | timeout
```

### 6.4 Worker Service

Responsibilities:

- consume RabbitMQ events,
- process asynchronous transaction events,
- write processing status,
- simulate background workload,
- expose consume duration and queue lag metrics.

Important metrics:

```text
rabbitmq_messages_consumed_total
rabbitmq_consume_errors_total
worker_processing_duration_seconds
worker_queue_lag_seconds
```

### 6.5 Risk Service, Future

Responsibilities:

- compute synthetic risk score,
- later support blockchain-like behavioral analysis,
- support ML extension if needed,
- expose scoring latency metrics.

This must not be implemented in the MVP unless the core system is already stable.

### 6.6 Notification Service, Future

Responsibilities:

- simulate email/SMS/Telegram notification,
- consume transaction events,
- inject failure in notification path,
- measure async observability.

This is optional for the second phase.

---

## 7. Observability Modes

The project must be configurable through environment variables.

```text
OBS_MODE=none
OBS_MODE=metrics
OBS_MODE=metrics_logs
OBS_MODE=metrics_logs_traces
OBS_MODE=otel_full
```

### 7.1 Mode 0 — Baseline Without Observability

Purpose:

```text
Measure the raw application behavior without observability instrumentation.
```

Enabled:

```text
Basic health endpoints
Minimal console errors only
Docker stats collection
k6 output collection
```

Disabled:

```text
Prometheus metrics
Structured logs
Loki
Distributed traces
OpenTelemetry Collector
Jaeger / Tempo
Grafana dashboards, except optional external container stats
```

Definition of Done:

```text
The system runs without Prometheus, Loki, Jaeger/Tempo, or OpenTelemetry Collector.
The core transaction flow works.
k6 baseline test runs successfully.
Docker stats are collected.
At least 3 repeated runs are stored.
```

KPIs:

```text
p50 latency
p95 latency
p99 latency
RPS
error rate
CPU usage
memory usage
network I/O
```

This baseline is critical.  
If the baseline is unstable, every comparison after it becomes scientifically weak.

---

### 7.2 Mode 1 — Metrics Only

Purpose:

```text
Measure the overhead and value of metrics without logs or traces.
```

Enabled:

```text
Prometheus metrics
/metrics endpoint in every service
Basic Grafana dashboard
Service-level counters and histograms
```

Disabled:

```text
Structured JSON logs
Loki
Distributed traces
Jaeger / Tempo
Full OpenTelemetry Collector pipeline
```

Required metrics:

```text
http_requests_total
http_request_duration_seconds
http_errors_total
db_query_duration_seconds
redis_operation_duration_seconds
rabbitmq_publish_duration_seconds
rabbitmq_consume_duration_seconds
process_cpu_seconds_total
process_resident_memory_bytes
```

Definition of Done:

```text
Every service exposes /metrics.
Prometheus scrapes all services.
Grafana shows RPS, latency, error rate, CPU, and memory.
The same k6 test used in baseline is executed.
Overhead compared to baseline is calculated.
```

KPIs:

```text
100% services scraped by Prometheus
At least 8 useful metrics available
At least 1 Grafana dashboard
3 repeated test runs
p95 overhead calculated
CPU overhead calculated
memory overhead calculated
```

---

### 7.3 Mode 2 — Metrics + Logs

Purpose:

```text
Measure the additional overhead and debugging value of structured logs.
```

Enabled:

```text
Prometheus metrics
Structured JSON logs
Correlation ID
Request ID
Loki
Grafana log exploration
```

Disabled:

```text
Distributed tracing
Jaeger / Tempo
Full OpenTelemetry trace pipeline
```

Required log fields:

```json
{
  "timestamp": "2026-05-28T12:00:00.000Z",
  "level": "info",
  "service": "transaction-service",
  "environment": "experiment",
  "version": "1.0.0",
  "correlationId": "abc-123",
  "requestId": "req-456",
  "method": "POST",
  "path": "/transactions",
  "statusCode": 201,
  "durationMs": 84,
  "message": "Transaction created"
}
```

Definition of Done:

```text
Every request has a correlation ID.
Correlation ID is propagated from API Gateway to downstream services.
Logs are emitted as JSON.
Loki receives logs.
Grafana can filter logs by service, level, route, and correlation ID.
Log volume per test run is measured.
```

KPIs:

```text
At least 95% of requests have correlation_id.
Log search by correlation_id works.
Log volume per 10,000 requests is measured.
p95 overhead compared to metrics-only is calculated.
Storage cost estimate is documented.
```

---

### 7.4 Mode 3 — Metrics + Logs + Traces

Purpose:

```text
Measure the debugging value and overhead of distributed tracing.
```

Enabled:

```text
Metrics
Structured logs
Distributed traces
Trace ID
Span ID
Context propagation across HTTP
Context propagation across RabbitMQ
Jaeger or Tempo
```

Required trace path:

```text
api-gateway
  -> transaction-service
     -> PostgreSQL query
     -> Redis operation
     -> payment-service
     -> RabbitMQ publish
        -> worker-service consume
```

Required span attributes:

```text
service.name
service.version
deployment.environment
http.method
http.route
http.status_code
db.system
db.operation
messaging.system
messaging.destination
error
exception.type
exception.message
```

Definition of Done:

```text
A full transaction request is visible as a distributed trace.
trace_id is available in logs.
Database and RabbitMQ operations appear as spans.
A slow service is visible in the trace waterfall.
The same load test is executed and compared against previous modes.
```

KPIs:

```text
At least 90% of successful requests have complete traces.
At least 5 spans are generated for the main transaction flow.
Trace lookup works by trace_id.
Root cause for a simple slow-payment failure is found in under 2 minutes.
Trace volume per 10,000 requests is measured.
```

---

### 7.5 Mode 4 — Full OpenTelemetry Pipeline

Purpose:

```text
Evaluate a realistic vendor-neutral telemetry pipeline using OpenTelemetry Collector.
```

Enabled:

```text
OpenTelemetry SDK
OTLP exporters
OpenTelemetry Collector
Metrics pipeline
Logs pipeline
Traces pipeline
Sampling configuration
Resource attributes
Prometheus exporter
Loki exporter or log forwarding
Jaeger / Tempo exporter
Grafana unified dashboards
Alerting rules
```

Definition of Done:

```text
Services export telemetry through OTLP.
Services do not directly export to all backends.
OpenTelemetry Collector receives telemetry.
Collector routes metrics, logs, and traces to the correct backends.
Grafana dashboards show correlated telemetry.
Alerts exist for high latency and high error rate.
Sampling configuration is documented.
```

KPIs:

```text
100% services export telemetry through OTLP.
At least 3 telemetry pipelines are configured.
At least 3 alert rules exist.
Trace-log correlation is functional.
Full pipeline overhead is measured.
Telemetry volume is measured.
```

---

## 8. Performance Measurement Strategy

### 8.1 Metrics to Collect

Application-level:

```text
p50 latency
p95 latency
p99 latency
requests per second
error rate
timeout rate
successful transaction count
failed transaction count
```

Infrastructure-level:

```text
CPU usage per container
memory usage per container
network RX/TX
disk I/O
container restart count
service startup time
```

Telemetry-level:

```text
number of metrics series
log volume in MB
trace count
span count
collector CPU usage
collector memory usage
Prometheus storage size
Loki storage size
Jaeger/Tempo storage size
```

Database-level:

```text
query execution time
rows scanned
rows returned
index size
table size
insert latency
update latency
cache hit ratio
```

### 8.2 Overhead Formula

```text
overhead_percent = ((observed_value - baseline_value) / baseline_value) * 100
```

Examples:

```text
latency_overhead_percent
cpu_overhead_percent
memory_overhead_percent
network_overhead_percent
storage_overhead_percent
```

### 8.3 Repeatability Requirements

Minimum:

```text
3 runs per experiment
same hardware
same Docker resources
same seed data
same k6 script
same duration
same warm-up time
```

Better:

```text
5 runs per experiment
mean
median
standard deviation
confidence interval
outlier notes
```

Hard rule:

> A single run is not evidence.

If one experiment is executed only once, it may be shown as a demo, but it should not be used as a research conclusion.

---

## 9. k6 Load Testing Plan

### 9.1 Smoke Test

Purpose:

```text
Verify that the system works before serious testing.
```

Configuration:

```text
1-5 virtual users
1 minute
low request rate
```

Definition of Done:

```text
All critical endpoints respond.
No service crashes.
Error rate is 0% or near 0%.
```

### 9.2 Baseline Load Test

Purpose:

```text
Generate stable comparable results across observability modes.
```

Configuration:

```text
50 virtual users
5 minutes
constant arrival rate or constant VUs
```

Target endpoints:

```text
POST /transactions
GET /transactions/:id
GET /users/:userId/transactions
```

Definition of Done:

```text
Same script is used across all observability modes.
Results are exported to JSON or CSV.
Docker stats are collected during the run.
```

### 9.3 Stress Test

Purpose:

```text
Find the point where the system starts degrading.
```

Configuration:

```text
50 VUs -> 100 VUs -> 200 VUs -> 500 VUs
10-15 minutes total
```

Measured:

```text
latency curve
throughput curve
error rate growth
CPU saturation
memory pressure
queue lag
```

### 9.4 Spike Test

Purpose:

```text
Measure behavior under sudden traffic changes.
```

Configuration:

```text
10 VUs -> 300 VUs -> 10 VUs
```

Measured:

```text
recovery time
error spike
p99 latency spike
RabbitMQ queue buildup
```

### 9.5 Soak Test

Purpose:

```text
Detect memory leaks, slow resource growth, and long-running stability problems.
```

Configuration:

```text
50-100 VUs
30-60 minutes
```

For a university project, 30 minutes may be acceptable.  
For a research-style report, longer is better if the machine can handle it.

---

## 10. Experiment Matrix

### 10.1 Observability Overhead Matrix

| Experiment ID | Mode | Metrics | Logs | Traces | OTel Collector | Goal |
|---|---|---:|---:|---:|---:|---|
| E0 | none | no | no | no | no | baseline |
| E1 | metrics | yes | no | no | no | metrics overhead |
| E2 | metrics_logs | yes | yes | no | partial | logging overhead |
| E3 | metrics_logs_traces | yes | yes | yes | partial | tracing overhead |
| E4 | otel_full | yes | yes | yes | yes | full pipeline overhead |

Each experiment must use the same:

```text
dataset
load profile
hardware
Docker resource limits
service replicas
test duration
warm-up period
```

### 10.2 Failure Injection Matrix

| Failure ID | Scenario | Injected In | Expected Symptom | Best Tool |
|---|---|---|---|---|
| F1 | slow payment | payment-service | high latency | traces |
| F2 | payment 500 errors | payment-service | error rate spike | metrics + logs |
| F3 | slow DB query | transaction-service/PostgreSQL | p95 increase | traces + DB metrics |
| F4 | RabbitMQ consumer stopped | worker-service | queue lag | metrics |
| F5 | Redis unavailable | Redis/read path | cache miss + latency | logs + metrics |
| F6 | memory pressure | transaction-service | latency/error growth | metrics |
| F7 | invalid event payload | worker-service | processing error | logs |
| F8 | partial network delay | service-to-service call | distributed latency | traces |

### 10.3 Indexing Experiment Matrix

PostgreSQL:

| Strategy | Index |
|---|---|
| I0 | no index |
| I1 | index(user_id) |
| I2 | index(created_at) |
| I3 | composite index(user_id, created_at DESC) |
| I4 | composite index(status, created_at) |
| I5 | partial index WHERE status = 'FAILED' |
| I6 | composite index(user_id, status, created_at DESC) |

MongoDB:

| Strategy | Index |
|---|---|
| M0 | no index |
| M1 | index(userId) |
| M2 | index(createdAt) |
| M3 | compound index(userId, createdAt) |
| M4 | compound index(status, createdAt) |
| M5 | compound index(userId, status, createdAt) |

### 10.4 Orchestration Comparison Matrix

| Target | Required | Goal |
|---|---:|---|
| Docker Compose | yes | local reproducibility and baseline |
| Docker Swarm | yes/recommended | lightweight orchestration comparison |
| Kubernetes | optional | challenge mode and production-grade comparison |

Measured:

```text
startup time
deployment complexity
configuration size
service discovery behavior
scaling behavior
failure recovery time
observability integration complexity
resource overhead
```

---

## 11. Database Indexing Experiments

### 11.1 PostgreSQL Dataset Size

MVP:

```text
100,000 transactions
10,000 users
10,000 wallets
```

Research-grade:

```text
1,000,000 transactions
100,000 users
100,000 wallets
```

If the local machine is weak, use 100k first.  
Do not pretend that 10k rows proves anything serious about indexing. It does not.

### 11.2 Query Patterns

Q1 — User transaction history:

```sql
SELECT *
FROM transactions
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 50;
```

Q2 — Status and time range:

```sql
SELECT *
FROM transactions
WHERE status = $1
AND created_at BETWEEN $2 AND $3;
```

Q3 — Suspicious high-value transactions:

```sql
SELECT *
FROM transactions
WHERE amount > $1
AND created_at > $2;
```

Q4 — User status in time range:

```sql
SELECT *
FROM transactions
WHERE user_id = $1
AND status = $2
AND created_at BETWEEN $3 AND $4;
```

Q5 — Aggregate per user:

```sql
SELECT user_id, COUNT(*), SUM(amount)
FROM transactions
WHERE created_at BETWEEN $1 AND $2
GROUP BY user_id
ORDER BY SUM(amount) DESC
LIMIT 100;
```

### 11.3 Required Measurements

For every query and index strategy:

```text
EXPLAIN ANALYZE output
query execution time
rows scanned
rows returned
index usage
endpoint p95 latency under load
endpoint p99 latency under load
CPU usage
memory usage
index size
table size
insert latency
```

### 11.4 Definition of Done

```text
At least 4 query patterns are tested.
At least 5 index strategies are tested.
EXPLAIN ANALYZE output is stored for every strategy.
k6 endpoint tests are executed for each strategy.
Read improvement and write overhead are reported separately.
Charts are generated.
```

### 11.5 KPI

```text
At least 20 PostgreSQL experiment combinations
p95 latency reported for every combination
query execution time reported for every combination
index size reported for every strategy
write overhead measured
results stored as CSV/JSON
```

---

## 12. MongoDB / NoSQL Indexing Experiments

MongoDB must not be added too early.

The correct order is:

```text
1. Finish PostgreSQL experiment.
2. Stabilize the experiment runner.
3. Add MongoDB with equivalent dataset and query patterns.
4. Compare only comparable workloads.
```

### 12.1 MongoDB Collection Shape

```json
{
  "_id": "uuid",
  "userId": "uuid",
  "walletId": "uuid",
  "amount": 350.75,
  "currency": "USD",
  "status": "FAILED",
  "type": "TRANSFER",
  "createdAt": "2026-05-28T12:00:00Z",
  "updatedAt": "2026-05-28T12:00:00Z",
  "metadata": {
    "country": "FI",
    "device": "web",
    "riskLevel": "medium"
  }
}
```

### 12.2 MongoDB Query Patterns

```javascript
db.transactions.find({ userId }).sort({ createdAt: -1 }).limit(50)

db.transactions.find({
  status,
  createdAt: { $gte: from, $lte: to }
})

db.transactions.find({
  amount: { $gt: threshold },
  createdAt: { $gte: from }
})

db.transactions.find({
  userId,
  status,
  createdAt: { $gte: from, $lte: to }
})
```

### 12.3 Definition of Done

```text
MongoDB service has equivalent endpoints.
Dataset is comparable to PostgreSQL dataset.
At least 4 MongoDB index strategies are tested.
Load tests are repeated with same k6 scripts or equivalent scripts.
Results are compared carefully and limitations are documented.
```

### 12.4 Warning

Do not write shallow conclusions like:

```text
MongoDB is faster than PostgreSQL.
PostgreSQL is better than MongoDB.
```

That is amateur work.

A correct conclusion looks like:

```text
For this dataset, access pattern, index strategy, hardware environment, and load profile, PostgreSQL/MongoDB showed lower p95 latency for this specific query type.
```

---

## 13. Failure Injection and Debuggability Measurement

### 13.1 Failure Injection Flags

Payment service:

```text
PAYMENT_DELAY_MS=1000
PAYMENT_ERROR_RATE=0.2
PAYMENT_TIMEOUT_RATE=0.1
PAYMENT_MODE=normal | slow | error | timeout
```

Database:

```text
DB_SLOW_QUERY=true
DB_SLOW_QUERY_DELAY_MS=500
DB_CONNECTION_ERROR_RATE=0.05
```

Worker:

```text
WORKER_DISABLED=true
WORKER_PROCESSING_DELAY_MS=1000
WORKER_ERROR_RATE=0.1
```

Redis:

```text
REDIS_DISABLED=true
REDIS_TIMEOUT_RATE=0.1
```

### 13.2 Debuggability Metrics

For every failure scenario:

```text
failure_start_timestamp
first_visible_symptom_timestamp
first_alert_timestamp
root_cause_identified_timestamp
time_to_detect_seconds
time_to_root_cause_seconds
number_of_tools_used
number_of_manual_steps
root_cause_accuracy
```

### 13.3 Manual Debugging Protocol

The person running the experiment must follow a consistent protocol.

Example:

```text
1. Start k6 load test.
2. Inject failure at timestamp T0.
3. Do not inspect source code.
4. Use only the telemetry available in the current OBS_MODE.
5. Record the first time the issue is visible.
6. Record the time when root cause is identified.
7. Record which tools were used.
8. Record whether the diagnosis was correct.
```

### 13.4 Definition of Done

```text
At least 4 failure scenarios are implemented.
Each scenario is tested in baseline and full-OTel modes.
At least 2 intermediate modes are tested for selected failures.
Detection time and root-cause time are measured.
Results are stored in a structured format.
```

### 13.5 KPI

```text
At least 4 failure scenarios
At least 8 baseline-vs-full-OTel comparisons
Root-cause accuracy recorded
Detection time chart generated
Debuggability improvement calculated
```

---

## 14. Deployment Targets

### 14.1 Docker Compose

Purpose:

```text
Local reproducibility, development, controlled experiments.
```

Required files:

```text
docker-compose.base.yml
docker-compose.observability.yml
docker-compose.metrics.yml
docker-compose.logs.yml
docker-compose.traces.yml
docker-compose.full-otel.yml
```

Definition of Done:

```text
One command starts the full system.
All services have health checks.
Volumes are defined explicitly.
Networks are defined explicitly.
Environment variables are documented.
```

KPI:

```text
docker compose up works
100% services healthy
startup time measured
baseline experiment runs successfully
```

### 14.2 Docker Swarm

Purpose:

```text
Lightweight orchestration comparison.
```

Required:

```text
docker stack deploy
replica configuration
service scaling
restart policy
overlay network
secrets/configs if needed
```

Definition of Done:

```text
The application runs as a Docker Swarm stack.
At least one service can be scaled to multiple replicas.
Failure recovery is tested by killing a container.
Load test is executed against Swarm deployment.
```

KPI:

```text
stack deploy works
transaction-service scaled to 2 or 3 replicas
recovery time measured
p95 latency measured
observability integration documented
```

### 14.3 Kubernetes, Optional Challenge Mode

Purpose:

```text
Production-grade orchestration comparison.
```

Recommended local target:

```text
k3d or minikube
```

Required manifests:

```text
Deployment
Service
ConfigMap
Secret
Ingress or port-forward strategy
PersistentVolumeClaim where needed
HorizontalPodAutoscaler optional
```

Definition of Done:

```text
Application runs in Kubernetes.
Services communicate through Kubernetes services.
At least one service has multiple replicas.
A pod failure recovery test is executed.
Observability stack either runs inside the cluster or connects from outside.
```

KPI:

```text
all pods ready
transaction-service scaled
pod kill recovery time measured
p95 latency measured
resource overhead measured
configuration complexity documented
```

Important warning:

> Do not start with Kubernetes.  
> Kubernetes before a stable Compose-based system is a productivity trap.

---

## 15. Repository Structure

Recommended structure:

```text
observable-microservice-lab/
  apps/
    api-gateway/
    transaction-service/
    payment-service/
    worker-service/
    notification-service/
    risk-service/
    mongo-transaction-service/

  packages/
    contracts/
    config/
    logger/
    metrics/
    tracing/
    database/
    messaging/
    testing/

  infra/
    docker/
      compose/
        docker-compose.base.yml
        docker-compose.metrics.yml
        docker-compose.logs.yml
        docker-compose.traces.yml
        docker-compose.full-otel.yml
      swarm/
      kubernetes/
    prometheus/
    grafana/
      dashboards/
      provisioning/
    loki/
    jaeger/
    tempo/
    otel-collector/
    rabbitmq/
    postgres/
    mongo/

  load-tests/
    k6/
      smoke.js
      baseline.js
      stress.js
      spike.js
      soak.js
      failure-payment-slow.js
      failure-db-slow.js
      failure-rabbitmq-consumer.js

  experiments/
    observability-overhead/
    failure-injection/
    indexing-postgres/
    indexing-mongodb/
    orchestration-comparison/

  results/
    raw/
    processed/
    charts/
    reports/

  scripts/
    seed-postgres.ts
    seed-mongo.ts
    run-experiment.sh
    collect-docker-stats.sh
    export-results.ts
    generate-charts.ts

  docs/
    architecture.md
    research-design.md
    experiment-protocol.md
    definition-of-done.md
    observability-overhead-report.md
    indexing-report.md
    failure-injection-report.md
    orchestration-comparison.md
    final-report.md
```

---

## 16. Phase-by-Phase Roadmap

---

# Phase 0 — Research Design

## Objective

Define the project as a research-oriented engineering system before writing too much code.

## Tasks

```text
[ ] Define research questions.
[ ] Define hypotheses.
[ ] Define observability modes.
[ ] Define load profiles.
[ ] Define failure scenarios.
[ ] Define experiment matrix.
[ ] Define KPI list.
[ ] Define result file formats.
[ ] Define hardware/environment documentation template.
[ ] Define naming convention for experiment results.
```

## Definition of Done

```text
docs/research-design.md exists.
docs/experiment-protocol.md exists.
All experiment variables are defined.
All dependent and independent variables are documented.
Experiment result format is defined.
```

## KPIs

```text
At least 5 research questions.
At least 5 hypotheses.
At least 5 observability modes.
At least 4 failure scenarios.
At least 3 load profiles.
At least 1 result schema.
```

## Deliverables

```text
research-design.md
experiment-protocol.md
experiment-matrix.md
```

---

# Phase 1 — Monorepo and Service Foundation

## Objective

Create a clean, maintainable, production-style project structure.

## Tasks

```text
[x] Initialize pnpm workspace or Nx monorepo.
[x] Create api-gateway NestJS app.
[x] Create transaction-service NestJS app.
[x] Create payment-service NestJS app.
[x] Create worker-service NestJS app.
[x] Create shared contracts package.
[x] Create shared config package.
[x] Create shared logger package.
[x] Create shared metrics package.
[x] Create shared tracing package.
[x] Add linting.
[x] Add formatting.
[x] Add unit test setup.
[x] Add Dockerfile for every service.
[x] Add docker-compose base file.
```

## Definition of Done

```text
All services build successfully.
All services start locally.
All services start in Docker.
All services expose /health.
CI runs lint and tests.
README contains local startup instructions.
```

## KPIs

```text
100% services build successfully.
100% services expose /health.
At least 10 unit tests exist.
docker compose up starts all base services.
No TypeScript strict-mode errors.
```

## Deliverables

```text
Monorepo skeleton
Base Docker Compose
Health endpoints
Initial CI pipeline
```

---

# Phase 2 — Core Business Flow

## Objective

Implement a real request path that crosses multiple services and infrastructure components.

## Required Flow

```text
POST /transactions
  -> api-gateway
  -> transaction-service
  -> PostgreSQL write
  -> Redis cache write
  -> payment-service call
  -> RabbitMQ publish
  -> worker-service consume
  -> transaction event persisted
```

## Tasks

```text
[x] Implement transaction creation endpoint.
[x] Implement transaction read endpoint.
[x] Implement user transaction history endpoint.
[x] Implement PostgreSQL schema.
[x] Implement migrations.
[x] Implement Redis cache.
[x] Implement RabbitMQ publisher.
[x] Implement RabbitMQ consumer.
[x] Implement payment simulation.
[x] Implement integration tests.
[x] Implement seed script.
```

## Definition of Done

```text
A transaction can be created through the API Gateway.
Transaction data is stored in PostgreSQL.
Transaction lookup uses Redis cache.
Payment service is called.
Transaction event is published to RabbitMQ.
Worker service consumes the event.
Integration test covers the full flow.
```

## KPIs

```text
Core flow success rate >= 95% under smoke load.
p95 latency < 500 ms under light load.
Error rate < 1% under normal conditions.
At least 1 end-to-end integration test.
```

## Deliverables

```text
Working transaction flow
Database schema
RabbitMQ integration
Redis integration
Seed data
Integration tests
```

---

# Phase 3 — Baseline Without Observability

## Objective

Measure the raw system before adding observability.

## Tasks

```text
[x] Add OBS_MODE=none.
[x] Disable metrics.
[x] Disable structured logs.
[x] Disable tracing.
[x] Disable OpenTelemetry Collector.
[x] Run smoke test.
[x] Run baseline k6 test.
[x] Collect Docker stats.
[x] Store raw results.
[x] Repeat at least 3 times.
```

## Definition of Done

```text
System runs without observability stack.
Baseline k6 test completes.
Docker stats are collected.
At least 3 baseline runs are stored.
Mean and standard deviation are calculated.
```

## KPIs

```text
3 successful baseline runs.
Run-to-run variance < 15%.
Error rate < 1%.
p50/p95/p99 latency recorded.
CPU and memory recorded.
```

## Deliverables

```text
baseline raw results
baseline processed CSV
baseline summary report
```

---

# Phase 4 — Metrics Only

## Objective

Add service-level metrics and measure their overhead.

## Tasks

```text
[x] Add Prometheus client.
[x] Expose /metrics in every service.
[x] Add HTTP request duration histogram.
[x] Add HTTP request counter.
[x] Add error counter.
[x] Add DB query duration histogram.
[x] Add Redis operation duration metrics.
[x] Add RabbitMQ publish/consume metrics.
[x] Configure Prometheus.
[x] Configure Grafana dashboard.
[x] Run the same k6 baseline test.
[x] Calculate overhead.
```

## Definition of Done

```text
Every service exposes /metrics.
Prometheus scrapes all services.
Grafana dashboard displays key metrics.
Metrics-only test is repeated at least 3 times.
Overhead vs baseline is calculated.
```

## KPIs

```text
100% services scraped.
At least 8 application metrics.
At least 1 Grafana dashboard.
3 successful test runs.
p95 overhead calculated.
CPU and memory overhead calculated.
```

## Deliverables

```text
Prometheus config
Grafana dashboard
Metrics-only experiment results
Overhead report
```

---

# Phase 5 — Metrics + Logs

## Objective

Add structured logging and correlation IDs.

## Tasks

```text
[x] Implement JSON logger.
[x] Implement correlation ID middleware.
[x] Propagate correlation ID to downstream HTTP calls.
[x] Propagate correlation ID to RabbitMQ messages.
[x] Add request logs.
[x] Add error logs.
[x] Add business event logs.
[x] Configure Loki.
[x] Configure Grafana log exploration.
[x] Run the same k6 test.
[x] Calculate logging overhead.
```

## Definition of Done

```text
All logs are structured JSON.
Correlation ID is present in logs.
Correlation ID is propagated across service boundaries.
Loki receives logs.
Grafana can filter by correlation ID.
Log volume is measured.
```

## KPIs

```text
>= 95% requests have correlation_id.
Log search by correlation_id works.
Log volume per 10,000 requests measured.
p95 overhead vs metrics-only calculated.
Storage overhead estimated.
```

## Deliverables

```text
Logger package
Loki config
Grafana logs dashboard
Metrics+logs experiment results
```

---

# Phase 6 — Metrics + Logs + Traces

## Objective

Add distributed tracing and trace-log correlation.

## Tasks

```text
[x] Add OpenTelemetry SDK.
[x] Add HTTP instrumentation.
[x] Add PostgreSQL instrumentation.
[x] Add Redis instrumentation.
[x] Add RabbitMQ instrumentation or manual spans.
[x] Add trace context propagation.
[x] Add trace_id to logs.
[x] Configure Jaeger or Tempo.
[x] Run baseline load test.
[x] Calculate tracing overhead.
```

## Definition of Done

```text
A full transaction flow appears as a trace.
HTTP, DB, Redis, and RabbitMQ operations appear as spans.
trace_id is visible in logs.
Slow payment scenario is visible in trace waterfall.
Tracing overhead is measured.
```

## KPIs

```text
>= 90% successful requests have complete traces.
At least 5 spans per main flow.
Trace lookup by trace_id works.
Trace volume per 10,000 requests measured.
p95 overhead vs metrics+logs calculated.
```

## Deliverables

```text
Tracing package
Jaeger/Tempo config
Trace screenshots or exported traces
Metrics+logs+traces experiment results
```

## Completed Evidence

```text
Report: results/reports/metrics-logs-traces-summary.md
Processed CSV: results/processed/metrics-logs-traces-summary.csv
Raw trace summary: results/raw/metrics-logs-traces-2026-06-03T07-51-55-324Z/jaeger-trace-volume.json
Raw trace sample: results/raw/metrics-logs-traces-2026-06-03T07-51-55-324Z/jaeger-trace-sample.json
Complete main-flow trace rate: 100.00%
Trace volume: 10044.86 traces per 10,000 requests
Span volume: 66711.53 spans per 10,000 requests
p95 overhead vs metrics+logs: -54.63%
```

---

# Phase 7 — Full OpenTelemetry Pipeline

## Objective

Move telemetry to a more realistic collector-based architecture.

## Tasks

```text
[x] Configure OpenTelemetry Collector.
[x] Export telemetry from services through OTLP.
[x] Configure metrics pipeline.
[x] Configure logs pipeline.
[x] Configure traces pipeline.
[x] Add sampling configuration.
[x] Add resource attributes.
[x] Add service.name, service.version, deployment.environment.
[x] Add Grafana dashboards.
[x] Add alerting rules.
[x] Run load tests.
[x] Measure collector overhead.
```

## Definition of Done

```text
Services export telemetry through OTLP.
OpenTelemetry Collector receives telemetry.
Collector routes metrics, logs, and traces.
Grafana shows unified observability dashboards.
Alerts exist for high latency and error rate.
Collector CPU and memory are measured.
```

## KPIs

```text
100% services use OTLP.
At least 3 collector pipelines.
At least 3 alert rules.
Trace-log correlation works.
Collector overhead measured.
Full pipeline overhead calculated.
```

## Deliverables

```text
otel-collector config
Full observability dashboard
Alert rules
Full OTel experiment results
```

## Completed Evidence

```text
Report: results/reports/otel-full-summary.md
Processed CSV: results/processed/otel-full-summary.csv
Raw result directory: results/raw/otel-full-2026-06-03T14-27-05-985Z
Raw log volume summary: results/raw/otel-full-2026-06-03T14-27-05-985Z/loki-log-volume.json
Raw trace summary: results/raw/otel-full-2026-06-03T14-27-05-985Z/jaeger-trace-volume.json
Raw trace sample: results/raw/otel-full-2026-06-03T14-27-05-985Z/jaeger-trace-sample.json
Successful runs: 3
Mean p95 latency: 68.47 ms
Mean error rate: 0.0000
Mean Docker CPU: 14.74%
Max observed memory: 146800640 bytes
Mean OpenTelemetry Collector CPU: 18.00%
Max OpenTelemetry Collector memory: 82994790 bytes
Loki log entries: 10253
Jaeger traces: 1811
Jaeger spans: 12011
Complete main-flow trace rate: 100.00%
Trace-log correlation: verified by smoke:otel-full
p95 overhead vs metrics+logs+traces: 150.00%
Docker CPU overhead vs metrics+logs+traces: 11.84%
Max memory overhead vs metrics+logs+traces: -6.17%
```

---

# Phase 8 — Observability Overhead Experiments

## Objective

Run the complete comparison across all observability modes.

## Tasks

```text
[x] Run E0 baseline.
[x] Run E1 metrics only.
[x] Run E2 metrics + logs.
[x] Run E3 metrics + logs + traces.
[x] Run E4 full OpenTelemetry pipeline.
[x] Repeat every experiment at least 3 times.
[x] Collect k6 results.
[x] Collect Docker stats.
[x] Collect telemetry volume.
[x] Process results.
[x] Generate charts.
[x] Write overhead analysis.
```

## Definition of Done

```text
All 5 observability modes are tested.
At least 15 total experiment runs exist.
Raw and processed results are stored.
Charts are generated.
The overhead report is written.
```

## Completed Evidence

```text
Aggregator: scripts/aggregate-overhead.ts (pnpm overhead:report)
Combined CSV: results/processed/observability-overhead.csv
Combined JSON: results/processed/observability-overhead.json
Report: docs/observability-overhead-report.md
Charts (6): results/charts/latency-comparison.svg, cpu-comparison.svg,
  memory-comparison.svg, p95-overhead.svg, log-volume.svg, trace-volume.svg
Observability modes compared: 5 (none, metrics, metrics_logs, metrics_logs_traces, otel_full)
Total experiment runs: 15 (3 per mode)
p95 overhead vs baseline: metrics -15.9%, metrics+logs +369.6%,
  metrics+logs+traces +113.0%, otel_full +432.6%
CPU overhead vs baseline: metrics -19.8%, metrics+logs +158.7%,
  metrics+logs+traces +118.0%, otel_full +143.8%
Collector cost (otel_full): 18.00% CPU, 79.2 MiB max memory
Log volume: ~56,900 entries per 10,000 requests across log modes
Trace volume: ~66,700 spans per 10,000 requests across trace modes
```

## KPIs

```text
5 observability modes tested.
At least 15 total runs.
At least 6 charts.
p50/p95/p99 latency comparison.
CPU/memory comparison.
log/trace volume comparison.
```

## Deliverables

```text
observability-overhead-report.md
results CSV/JSON
charts
experiment summary table
```

---

# Phase 9 — Failure Injection and Debuggability Measurement

## Objective

Measure how observability affects failure detection and root-cause analysis.

## Tasks

```text
[x] Implement payment-service delay injection.
[x] Implement payment-service error injection.
[x] Implement DB slow query injection.
[x] Implement RabbitMQ consumer stop scenario.
[x] Implement Redis failure scenario.
[x] Implement memory pressure scenario.
[ ] Run selected failures in baseline.
[ ] Run selected failures in full OTel mode.
[ ] Run selected failures in intermediate modes.
[ ] Record time to detect.
[ ] Record time to root cause.
[ ] Generate comparison chart.
```

> Implementation status: all six fault mechanisms, the failure-specific k6
> scripts, the manual debugging protocol, the observations schema, and the report
> generator (CSV + detection/root-cause charts) are implemented and verified. The
> remaining unchecked items are the human-in-the-loop measurement runs: a person
> must follow `docs/failure-injection-protocol.md` against a live stack and record
> the detection/root-cause timestamps. Those timings are deliberately not
> fabricated (see the anti-goals in section 21).

## Definition of Done

```text
At least 4 failure scenarios are implemented.
Each scenario is tested in baseline and full OTel modes.
Detection and root-cause times are recorded.
Debuggability improvement is calculated.
```

## KPIs

```text
At least 4 failure scenarios.
At least 8 baseline-vs-full-OTel runs.
Detection time measured.
Root-cause time measured.
Root-cause accuracy recorded.
```

## Deliverables

```text
failure-injection-report.md
debuggability-results.csv
detection-time chart
root-cause-time chart
```

## Completed Evidence

```text
Fault config + parsers: packages/config/src/index.ts (getPaymentFaultConfig,
  getDatabaseFaultConfig, getRedisFaultConfig, getWorkerFaultConfig,
  getMemoryPressureConfig) with unit tests in packages/config/src/index.spec.ts
Injection wiring:
  payment-service  -> PAYMENT_MODE / PAYMENT_DELAY_MS / PAYMENT_ERROR_RATE / PAYMENT_TIMEOUT_RATE
  transaction-svc  -> DB_SLOW_QUERY / DB_SLOW_QUERY_DELAY_MS / DB_CONNECTION_ERROR_RATE
                      REDIS_DISABLED / REDIS_TIMEOUT_RATE
                      MEMORY_PRESSURE_ENABLED / MEMORY_PRESSURE_MB / MEMORY_PRESSURE_LEAK_MB_PER_MIN
  worker-service   -> WORKER_DISABLED / WORKER_PROCESSING_DELAY_MS / WORKER_ERROR_RATE
  payment HTTP client now applies a PAYMENT_CLIENT_TIMEOUT_MS abort timeout
Compose: fault flags exposed (default off) in infra/docker/compose/docker-compose.base.yml
k6 scripts: load-tests/k6/failure-{payment-slow,payment-errors,db-slow,rabbitmq-consumer,redis}.js
Protocol: docs/failure-injection-protocol.md
Observations schema/template: experiments/failure-injection/observations.example.json
Report generator: scripts/failure-injection-report.ts (pnpm failure:report) ->
  results/processed/debuggability-results.csv,
  results/charts/detection-time.svg, results/charts/root-cause-time.svg,
  docs/failure-injection-report.md
Pending: human-run detection/root-cause timings (record into observations.json,
  status "measured", then re-run pnpm failure:report).
```

---

# Phase 10 — PostgreSQL Indexing Experiments

## Objective

Measure how indexing strategies affect service-level performance under load.

## Tasks

```text
[x] Generate large PostgreSQL dataset.
[ ] Implement query endpoints.
[x] Define query patterns.
[x] Create no-index baseline.
[x] Create single-column indexes.
[x] Create composite indexes.
[x] Create partial indexes.
[x] Run EXPLAIN ANALYZE.
[ ] Run k6 tests for every strategy.
[x] Measure read latency.
[x] Measure write latency.
[x] Measure index size.
[ ] Measure resource usage.
```

> The experiment measures query execution time directly via `EXPLAIN ANALYZE`
> percentiles — a cleaner signal than HTTP endpoint latency. The two unchecked
> read-path items (query endpoints + k6 per strategy) are a documented optional
> HTTP dimension; "resource usage" here means index/table size and write cost
> rather than per-query container CPU/memory. All numbers come from a real run.

## Definition of Done

```text
At least 4 query patterns are tested.
At least 5 index strategies are tested.
EXPLAIN ANALYZE is stored.
k6 endpoint latency is measured.
Read improvement and write penalty are reported separately.
```

## KPIs

```text
At least 20 experiment combinations.
p95 latency reported for every combination.
query execution time reported.
index size reported.
write overhead measured.
```

## Deliverables

```text
postgres-indexing-report.md
EXPLAIN ANALYZE outputs
indexing results CSV
charts
```

## Completed Evidence

```text
Runner: scripts/run-postgres-indexing.ts (pnpm indexing:run)
Dataset: 1,000,000 transactions / 100,000 users (research-grade; deterministic via INDEXING_SEED)
Index strategies: 7 (I0 none; I1 user_id; I2 created_at; I3 user_id,created_at DESC;
  I4 status,created_at; I5 partial WHERE status='failed'; I6 user_id,status,created_at)
Query patterns: 5 (Q1 user history; Q2 status+time; Q3 high-value; Q4 user+status+time; Q5 aggregate)
Combinations: 35 (>= 20), 15 EXPLAIN ANALYZE repetitions each
Statistics: bootstrap 95% CI on p95; parallel-scan rows accounted via Actual Loops
Report: docs/postgres-indexing-report.md
Processed CSV: results/processed/postgres-indexing.csv (with exec_p95_ci_lo/hi)
Raw plans: results/raw/postgres-indexing-<ts>/explain-<Ix>-<Qy>.txt (35) + meta.json
Charts: results/charts/indexing-query-p95.svg, indexing-q1-user-history.svg,
  indexing-write-penalty.svg, indexing-index-size.svg
Headline results (real 1M run):
  Q1 user history: composite cut p95 24.5ms -> 0.11ms (+99.6%, 16 rows vs 1M)
  Q4 user+status+time: I6 cut p95 20.0ms -> 0.04ms (+99.8%, 5 rows)
  Q2 status='failed': index cut p95 25.4ms -> ~13.5ms (examined 27,740 vs 1M)
  Q3 high-value (amount unindexed): full 1M seq scan; no index helps — honest negative
  Write penalty: indexes added +19% (partial) to +322% (3-column) insert latency
  Index sizes: I5 partial 3.9 MiB ... I6 composite 47.4 MiB
Pending (documented): HTTP query endpoints + k6 per-strategy load (optional dimension)
```

---

# Phase 11 — MongoDB / NoSQL Indexing Experiments

## Objective

Add a comparable NoSQL indexing experiment.

## Tasks

```text
[x] Add MongoDB service.
[ ] Add mongo-transaction-service.
[x] Seed comparable dataset.
[ ] Implement equivalent query endpoints.
[x] Create MongoDB index strategies.
[x] Run load tests.
[x] Measure read latency.
[x] Measure write latency.
[x] Measure index size.
[x] Compare with PostgreSQL carefully.
```

> Same methodological choice as Phase 10: the experiment measures query work
> directly via `explain("executionStats")` (documents examined, IXSCAN vs
> COLLSCAN) plus latency percentiles. The two unchecked items —
> `mongo-transaction-service` and HTTP query endpoints — are the optional HTTP
> dimension; "load tests" here means repeated query execution against the live
> collection. The MongoDB service is added to Compose under the `mongo` profile.
> All numbers come from a real run.

## Definition of Done

```text
MongoDB dataset is comparable to PostgreSQL dataset.
Equivalent query patterns are tested.
At least 4 MongoDB indexing strategies are tested.
Results are compared with limitations documented.
```

## KPIs

```text
At least 100k MongoDB documents.
At least 4 query patterns.
At least 4 index strategies.
At least 1 SQL-vs-NoSQL comparison report.
```

## Deliverables

```text
mongodb-indexing-report.md
sql-nosql-comparison.md
MongoDB experiment results
charts
```

## Completed Evidence

```text
Runners: scripts/run-mongo-indexing.ts (pnpm indexing:mongo),
  scripts/sql-nosql-comparison.ts (pnpm sql-nosql:report)
MongoDB service: docker-compose.base.yml `mongo` profile (mongo:7)
Dataset: 1,000,000 documents / 100,000 users (research-grade; deterministic mulberry32 PRNG),
  shape per section 12.1 (userId, walletId, amount, status, type, createdAt, metadata)
Index strategies: 6 (M0 none; M1 userId; M2 createdAt; M3 userId,createdAt desc;
  M4 status,createdAt; M5 userId,status,createdAt desc) — >= 4
Query patterns: 4 (Q1-Q4, equivalent to the PostgreSQL find queries) — >= 4
Combinations: 24, 15 explain("executionStats") repetitions each; bootstrap 95% CI on p95
Reports: docs/mongodb-indexing-report.md, docs/sql-nosql-comparison.md
Processed CSV: results/processed/mongodb-indexing.csv (with exec_p95_ci_lo/hi)
Raw plans: results/raw/mongo-indexing-<ts>/explain-<Mx>-<Qy>.json (24) + meta.json
Charts: mongo-query-p95, mongo-docs-examined, mongo-write-penalty, mongo-index-size,
  sql-nosql-examined-baseline, sql-nosql-examined-best
Headline results (real 1M run):
  Q1 user history: M5 IXSCAN examined 11 docs vs 1,000,000 COLLSCAN,
    and avoided the in-memory SORT
  Q1 anti-pattern: a createdAt-only index (M2) examined all 1M and was slower than COLLSCAN
  Q2 status='failed': M4 examined 27,553 docs (~2.8%)
  Q4 user+status+time: M5 examined 4 docs
  Write penalty: single-field indexes +155-202% insert latency; compounds varied
SQL-vs-NoSQL (structural, apples-to-apples, both 1M):
  Q1 examined PG 16 rows vs Mongo 11 docs; Q2 27,740 vs 27,553;
  Q3 PG 1M (amount unindexed) vs Mongo 493,229; Q4 5 vs 4 — same structural lines.
  Latency reported as indicative only (different timing methodologies), scoped
  conclusions per section 12.4 — no "X is faster than Y".
Pending (documented): mongo-transaction-service + HTTP endpoints (optional dimension)
```

---

# Phase 12 — Docker Compose vs Swarm vs Kubernetes

## Objective

Compare orchestration targets from a practical engineering perspective.

## Tasks

```text
[x] Run system in Docker Compose.
[x] Run system in Docker Swarm.
[ ] Optionally run system in Kubernetes.
[x] Measure startup time.
[x] Measure configuration size.
[x] Measure scaling behavior.
[x] Kill one service instance.
[x] Measure recovery time.
[ ] Run the same k6 load profile.
[x] Compare resource overhead.
[x] Document complexity.
```

> Compose and Swarm (the two required targets) were deployed and measured live.
> Kubernetes manifests are authored and statically validated with `kubeconform`
> (19/19 resources valid) but not run — no local cluster (k3d/minikube/kind) is
> present, and Kubernetes is the optional target. The k6 load-test-per-target item
> is left open: the comparison measures orchestration behaviour (startup, scaling,
> recovery, resource overhead) directly, which is the part that differs by
> orchestrator. All measured numbers come from real deployments.

## Definition of Done

```text
Compose deployment works.
Swarm deployment works.
Kubernetes deployment works if selected.
Same load test is executed for each target.
Failure recovery is tested.
Comparison report is written.
```

## KPIs

```text
2 deployment targets required.
3 deployment targets ideal.
At least 2 scaling scenarios.
At least 2 recovery scenarios.
Startup time measured.
Recovery time measured.
Resource overhead measured.
```

## Deliverables

```text
orchestration-comparison.md
compose configs
swarm configs
optional Kubernetes manifests
comparison table
```

## Completed Evidence

```text
Runner: scripts/run-orchestration.ts (pnpm orchestration:run)
Configs:
  Compose: infra/docker/compose/docker-compose.base.yml (existing)
  Swarm:   infra/docker/swarm/docker-stack.yml (deploy replicas, restart policy,
           resource limits, overlay network + routing mesh; ports env-overridable)
  Kubernetes: infra/docker/kubernetes/traceforge.yaml (19 resources: Namespace,
           ConfigMap, Secret, PVC, Deployments, Services, HPA) — kubeconform valid 19/19
Report: docs/orchestration-comparison.md
Processed CSV: results/processed/orchestration-comparison.csv
Raw: results/raw/orchestration-<ts>/runtime.json
Charts: orchestration-startup, orchestration-recovery, orchestration-config-size
Targets measured live: 2 (Compose + Swarm); Kubernetes authored + validated, not run
Headline results (real run):
  Startup: Compose 33.6s, Swarm 25.0s (Swarm has no depends_on ordering; variable)
  Scaling: Compose FAILED (host-port conflict, fixed published port per service);
           Swarm scaled transaction-service 1->3 and payment-service 1->2 via routing mesh
  Recovery: Compose none (killed container stayed "exited" — not a reconciler);
            Swarm auto-rescheduled killed tasks, mean ~14.8s (2 scenarios)
  Config size (non-comment lines): Swarm 123 (core), Kubernetes 356 (core),
           Compose 323 (includes observability profiles — superset, see report caveat)
Scaling scenarios: 2 (Swarm); Recovery scenarios: 2 (Swarm) — KPIs met
Pending (documented): k6 load test per target; Kubernetes runtime (optional, needs a cluster)
```

---

# Phase 13 — Final Report and Paper Draft

## Objective

Convert project results into a serious technical and academic document.

## Tasks

```text
[x] Write abstract.
[x] Write introduction.
[x] Write related work summary.
[x] Write system architecture.
[x] Write methodology.
[x] Write experiment setup.
[x] Write results.
[x] Write discussion.
[x] Write threats to validity.
[x] Write limitations.
[x] Write future work.
[x] Prepare charts and tables.
[x] Prepare GitHub README.
```

> The v1 report covers research questions RQ1 (observability overhead) with real
> measured data, and documents RQ2 (debuggability) as an implemented methodology
> whose human-run timings are pending. Findings are grounded strictly in the
> stored results; nothing is fabricated.

## Definition of Done

```text
Final report is complete.
All charts are included.
All tables are included.
Experiment methodology is reproducible.
Limitations are honestly documented.
Repository can be started by another developer.
```

## KPIs

```text
At least 10 pages equivalent report.
At least 6 charts.
At least 5 tables.
At least 5 experiment groups.
At least 1 reproducibility section.
```

## Deliverables

```text
final-report.md
paper-draft.md
README.md
charts
results
```

## Completed Evidence

```text
Final report: docs/final-report.md (abstract, intro, background, architecture,
  methodology, experiment setup, results, discussion, threats to validity,
  limitations, future work, conclusion, references, reproducibility)
Paper draft: docs/paper-draft.md (condensed skeleton + key-results table)
README: rewritten root README.md (icons, mermaid architecture, findings, roadmap)
Tables: 6 (modes, failure matrix, experiment setup, latency, overhead, resource/volume)
Charts: 6 measured (latency, cpu, memory, p95-overhead, log-volume, trace-volume)
  + 2 illustrative (detection-time, root-cause-time) clearly marked as not measured
Experiment groups: 5 observability modes (15 runs)
Data source: results/processed/observability-overhead.json (real, 15 runs)
Honesty: RQ2 debuggability presented as implemented methodology, timings pending.
```

---

## 17. Global Definition of Done

The whole project is done only when all of these are true:

```text
[ ] At least 4 real microservices exist.
[ ] PostgreSQL is used for real persistence.
[ ] Redis is used for a real read/cache path.
[ ] RabbitMQ is used for real async communication.
[ ] Docker Compose can start the system.
[ ] Observability modes can be switched.
[x] Baseline without observability is measured.
[x] Metrics-only mode is measured.
[x] Metrics+logs mode is measured.
[x] Metrics+logs+traces mode is measured.
[x] Full OpenTelemetry pipeline is measured.
[x] k6 scripts exist for smoke, baseline, stress, spike, and failure tests.
[x] Performance overhead is calculated.
[ ] Debuggability improvement is measured.
[ ] Failure detection time is measured.
[ ] Resource cost is measured.
[x] PostgreSQL indexing experiments are completed.
[x] MongoDB indexing experiment is planned or completed.
[x] Compose vs Swarm comparison is completed.
[x] Kubernetes comparison is optional but documented if implemented.
[x] Raw results are stored.
[x] Processed results are stored.
[x] Charts are generated.
[x] Final report is written.
```

---

## 18. Global KPI Table

| Category | KPI | Target |
|---|---|---:|
| Service health | healthy services | 100% |
| Test repeatability | variance between runs | < 15% |
| Normal-load reliability | error rate | < 1% |
| Metrics coverage | services with `/metrics` | 100% |
| Log correlation | requests with correlation ID | > 95% |
| Trace coverage | successful requests with full trace | > 90% |
| Observability experiments | modes tested | 5/5 |
| Experiment repetition | runs per mode | >= 3 |
| Failure scenarios | implemented scenarios | >= 4 |
| Load profiles | k6 profiles | >= 4 |
| PostgreSQL query patterns | tested patterns | >= 4 |
| PostgreSQL index strategies | tested strategies | >= 5 |
| MongoDB index strategies | future target | >= 4 |
| Deployment targets | required | Compose + Swarm |
| Deployment targets | ideal | Compose + Swarm + Kubernetes |
| Documentation | research/report docs | complete |
| Reproducibility | one-command startup | yes |

---

## 19. Technical Backlog

### 19.1 Backend Backlog

```text
[ ] Create monorepo.
[ ] Create API Gateway.
[ ] Create Transaction Service.
[ ] Create Payment Service.
[ ] Create Worker Service.
[ ] Create Notification Service, optional.
[ ] Create Risk Service, optional.
[ ] Add PostgreSQL migrations.
[ ] Add Redis integration.
[ ] Add RabbitMQ integration.
[ ] Add shared contracts.
[ ] Add validation.
[ ] Add error handling.
[ ] Add typed configuration.
[ ] Add integration tests.
```

### 19.2 Observability Backlog

```text
[ ] Create metrics package.
[x] Create logger package.
[x] Create tracing package.
[x] Add correlation ID middleware.
[x] Add HTTP context propagation.
[x] Add RabbitMQ context propagation.
[x] Add Prometheus.
[x] Add Grafana dashboards.
[x] Add Loki.
[x] Add Jaeger or Tempo.
[x] Add OpenTelemetry Collector.
[x] Add sampling config.
[x] Add alerting rules.
```

### 19.3 Load Testing Backlog

```text
[x] Create k6 smoke test.
[x] Create k6 baseline test.
[x] Create k6 stress test.
[x] Create k6 spike test.
[x] Create k6 soak test.
[x] Create failure-specific k6 scripts.
[ ] Export results.
[ ] Process results.
[ ] Generate charts.
```

### 19.4 Experiment Backlog

```text
[x] Run baseline without observability.
[x] Run metrics-only experiment.
[x] Run metrics+logs experiment.
[x] Run metrics+logs+traces experiment.
[x] Run full OpenTelemetry experiment.
[x] Aggregate observability-overhead comparison across all 5 modes.
[ ] Run failure injection experiments.
[x] Run PostgreSQL indexing experiments.
[x] Run MongoDB indexing experiments.
[x] Run Compose vs Swarm comparison.
[ ] Run optional Kubernetes comparison.
```

### 19.5 Documentation Backlog

```text
[x] architecture.md
[x] research-design.md
[x] experiment-protocol.md
[x] definition-of-done.md
[x] observability-overhead-report.md
[x] failure-injection-report.md
[x] postgres-indexing-report.md
[x] mongodb-indexing-report.md
[x] sql-nosql-comparison.md
[x] orchestration-comparison.md
[x] final-report.md
[x] paper-draft.md
```

---

## 20. Risk Register

| Risk | Impact | Probability | Mitigation |
|---|---:|---:|---|
| Project becomes too large | high | high | Keep MVP small; delay MongoDB and Kubernetes |
| Kubernetes consumes too much time | high | medium | Do Compose first, Swarm second, Kubernetes last |
| Observability setup becomes unstable | high | medium | Add one layer at a time |
| Results are noisy | high | high | Repeat tests, control hardware, use fixed load scripts |
| Dataset too small for indexing | medium | high | Use at least 100k rows; target 1M if possible |
| Too many services without value | medium | medium | Start with 4 services only |
| Logs become too large | medium | high | Measure log volume; use sampling where justified |
| Traces become too expensive | medium | medium | Add sampling strategy |
| Paper lacks novelty | high | medium | Focus on measured trade-offs, failure diagnosis, and indexing under observability |
| Manual debugging measurement is subjective | medium | high | Use fixed debugging protocol and timestamp recording |

---

## 21. Anti-Goals

These are things the project should not waste time on early.

```text
Do not build a complex frontend.
Do not build authentication unless required.
Do not build real payment integration.
Do not start with Kubernetes.
Do not add MongoDB before PostgreSQL experiments are stable.
Do not add blockchain before the observability platform is complete.
Do not compare frameworks unless it becomes a separate research project.
Do not manually fake experiment results.
Do not create charts from one run only.
```

A beautiful UI does not make this project stronger.  
A clean experiment design does.

---

## 22. Suggested Implementation Order

Strict order:

```text
1. Research design
2. Monorepo
3. Core services
4. Docker Compose
5. Core transaction flow
6. k6 smoke test
7. k6 baseline test without observability
8. Metrics only
9. Metrics + logs
10. Metrics + logs + traces
11. Full OpenTelemetry Collector
12. Observability overhead experiments
13. Failure injection
14. PostgreSQL indexing experiments
15. MongoDB indexing experiments
16. Docker Swarm
17. Optional Kubernetes
18. Final report
19. Paper draft
```

Do not violate this order unless there is a strong reason.

---

## 23. Paper Structure

A future paper can follow this structure:

```text
Title
Abstract
1. Introduction
2. Background
   2.1 Microservice observability
   2.2 Metrics, logs, and traces
   2.3 OpenTelemetry
   2.4 Containerized deployment
   2.5 Database indexing in service architectures
3. System Architecture
4. Methodology
   4.1 Workload design
   4.2 Observability modes
   4.3 Failure injection design
   4.4 Indexing experiment design
   4.5 Deployment comparison design
5. Experiment Setup
6. Results
   6.1 Observability overhead
   6.2 Debuggability improvement
   6.3 Failure detection time
   6.4 Resource cost
   6.5 Indexing experiments
   6.6 Orchestration comparison
7. Discussion
8. Threats to Validity
9. Limitations
10. Future Work
11. Conclusion
References
```

---

## 24. Possible Paper Titles

### Main Paper

```text
Evaluating Performance and Debuggability Trade-offs of Observability Instrumentation in Microservice Architectures
```

### More Practical Title

```text
Observability-Driven Performance Evaluation of Containerized Microservice Applications
```

### With Database Focus

```text
Observability-Based Evaluation of SQL and NoSQL Indexing Strategies in Microservice Data Stores
```

### With Deployment Focus

```text
A Comparative Evaluation of Observability Overhead Across Docker Compose, Docker Swarm, and Kubernetes Deployments
```

### Strong Combined Title

```text
Performance, Debuggability, and Resource-Cost Trade-offs of Observability in Containerized Microservice Systems
```

---

## 25. Final Senior-Level Judgment

The strong version of this project is:

```text
A controlled microservice observability laboratory that measures overhead, debugging value, failure detection, indexing performance, and orchestration trade-offs.
```

The weak version is:

```text
A few NestJS services with Prometheus, Grafana, and Docker Compose.
```

The difference is measurement.

If the project produces:

```text
repeatable experiments
raw results
processed results
charts
tables
failure reports
indexing comparisons
deployment comparisons
```

then it becomes a serious academic and portfolio project.

If it only produces:

```text
working services
dashboards
Docker files
```

then it is just another average microservice demo.

The project must be built as a measurement system from day one.

---

## 26. References and Documentation Sources

These references should be used while implementing and writing the final report:

- OpenTelemetry Documentation: https://opentelemetry.io/docs/
- OpenTelemetry Collector Documentation: https://opentelemetry.io/docs/collector/
- Prometheus Documentation: https://prometheus.io/docs/introduction/overview/
- Docker Compose Documentation: https://docs.docker.com/compose/
- Docker Swarm Stack Deploy Documentation: https://docs.docker.com/engine/swarm/stack-deploy/
- Kubernetes Documentation: https://kubernetes.io/docs/home/
- Grafana Loki Documentation: https://grafana.com/docs/loki/latest/
- Jaeger Documentation: https://www.jaegertracing.io/docs/latest/
- Grafana k6 Documentation: https://grafana.com/docs/k6/latest/
