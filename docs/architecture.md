# Architecture

Phase 1 defines the system boundary and package structure. The services are small
NestJS applications with a shared set of local packages:

- API Gateway
- Transaction Service
- Payment Service
- Worker Service
- Contracts package
- Config package
- Logger package
- Metrics package
- Tracing package

The first runtime contract is intentionally narrow: each service exposes `GET /health`
and reports its service name, version, uptime, timestamp, and selected observability
mode.

## Phase 2 Flow

```text
Client
  -> API Gateway
  -> Transaction Service
  -> PostgreSQL
  -> Redis
  -> Payment Service
  -> RabbitMQ
  -> Worker Service
  -> PostgreSQL transaction_events
```

The transaction service owns transaction writes and reads. The payment service only
simulates authorization. The worker service owns asynchronous event persistence.
