import { OnModuleDestroy } from "@nestjs/common";
import { TransactionCreatedEvent } from "@traceforge/contracts";
import {
  MetricsRegistry,
  createNoopMetricsRegistry,
  timeAsync
} from "@traceforge/metrics";
import { ServiceTracer, createNoopServiceTracer } from "@traceforge/tracing";
import { Pool } from "pg";
import { TransactionEventRepository } from "./transaction-event.repository";

export class PgTransactionEventRepository
  implements TransactionEventRepository, OnModuleDestroy
{
  private readonly pool: Pool;

  constructor(
    databaseUrl: string,
    private readonly metrics: MetricsRegistry = createNoopMetricsRegistry(),
    private readonly tracer: ServiceTracer = createNoopServiceTracer()
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl
    });
  }

  async persistTransactionCreatedEvent(event: TransactionCreatedEvent): Promise<void> {
    await this.tracer.withSpan(
      "postgres.persist_transaction_created_event",
      () =>
        timeAsync(
          (durationMs) =>
            this.metrics.recordDbQuery("persist_transaction_created_event", durationMs),
          () =>
            this.pool.query(
              `
        INSERT INTO transaction_events (id, transaction_id, event_type, payload, occurred_at)
        VALUES ($1, $2, $3, $4::jsonb, $5)
        ON CONFLICT (id) DO NOTHING
      `,
              [
                event.id,
                event.transactionId,
                event.type,
                JSON.stringify(event),
                event.occurredAt
              ]
            )
        ),
      {
        kind: "client",
        attributes: {
          "db.system.name": "postgresql",
          "db.operation.name": "persist_transaction_created_event"
        }
      }
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
