import { OnModuleDestroy } from "@nestjs/common";
import { DatabaseFaultConfig } from "@traceforge/config";
import { PaymentAuthorizationResponse, TransactionResponse } from "@traceforge/contracts";
import {
  MetricsRegistry,
  createNoopMetricsRegistry,
  timeAsync
} from "@traceforge/metrics";
import { ServiceTracer, createNoopServiceTracer } from "@traceforge/tracing";
import { Pool } from "pg";
import { CreateTransactionRequest } from "@traceforge/contracts";
import { TransactionRepository } from "./transaction-ports";

const NORMAL_FAULTS: DatabaseFaultConfig = {
  slowQuery: false,
  slowQueryDelayMs: 0,
  connectionErrorRate: 0
};

type TransactionRow = {
  id: string;
  user_id: string;
  amount: string;
  currency: string;
  description: string | null;
  status: TransactionResponse["status"];
  payment_status: TransactionResponse["paymentStatus"];
  payment_reference: string | null;
  created_at: Date;
  updated_at: Date;
};

export class PgTransactionRepository implements TransactionRepository, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    databaseUrl: string,
    private readonly metrics: MetricsRegistry = createNoopMetricsRegistry(),
    private readonly tracer: ServiceTracer = createNoopServiceTracer(),
    private readonly faults: DatabaseFaultConfig = NORMAL_FAULTS,
    private readonly random: () => number = Math.random
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl
    });
  }

  async createPendingTransaction(
    request: CreateTransactionRequest
  ): Promise<TransactionResponse> {
    const result = await this.query(
      "create_pending_transaction",
      `
      INSERT INTO transactions (user_id, amount, currency, description, status, payment_status)
      VALUES ($1, $2, $3, $4, 'pending', 'pending')
      RETURNING *
    `,
      [request.userId, request.amount, request.currency, request.description ?? null]
    );

    return mapTransactionRow(result.rows[0]);
  }

  async markPaymentResult(
    transactionId: string,
    payment: PaymentAuthorizationResponse
  ): Promise<TransactionResponse> {
    const result = await this.query(
      "mark_payment_result",
      `
      UPDATE transactions
      SET status = $2,
          payment_status = $2,
          payment_reference = $3,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
      [transactionId, payment.status, payment.providerReference]
    );

    return mapTransactionRow(result.rows[0]);
  }

  async markPaymentFailed(transactionId: string): Promise<TransactionResponse> {
    const result = await this.query(
      "mark_payment_failed",
      `
      UPDATE transactions
      SET status = 'failed',
          payment_status = 'failed',
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
      [transactionId]
    );

    return mapTransactionRow(result.rows[0]);
  }

  async findTransactionById(transactionId: string): Promise<TransactionResponse | null> {
    const result = await this.query(
      "find_transaction_by_id",
      "SELECT * FROM transactions WHERE id = $1",
      [transactionId]
    );

    return result.rows[0] ? mapTransactionRow(result.rows[0]) : null;
  }

  async findTransactionsByUserId(userId: string): Promise<TransactionResponse[]> {
    const result = await this.query(
      "find_transactions_by_user_id",
      `
      SELECT *
      FROM transactions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `,
      [userId]
    );

    return result.rows.map(mapTransactionRow);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private query(
    operation: string,
    sql: string,
    values: unknown[]
  ): Promise<{ rows: TransactionRow[] }> {
    return this.tracer.withSpan(
      `postgres.${operation}`,
      () =>
        timeAsync(
          (durationMs) => this.metrics.recordDbQuery(operation, durationMs),
          async () => {
            // Faults are applied inside the timed span so the slow query and the
            // connection error are both visible in db_query_duration and traces.
            if (this.random() < this.faults.connectionErrorRate) {
              throw new Error(`injected database connection error (${operation})`);
            }

            if (this.faults.slowQuery && this.faults.slowQueryDelayMs > 0) {
              await sleep(this.faults.slowQueryDelayMs);
            }

            return this.pool.query<TransactionRow>(sql, values);
          }
        ),
      {
        kind: "client",
        attributes: {
          "db.system.name": "postgresql",
          "db.operation.name": operation
        }
      }
    );
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function mapTransactionRow(row: TransactionRow): TransactionResponse {
  return {
    id: row.id,
    userId: row.user_id,
    amount: Number(row.amount),
    currency: row.currency,
    description: row.description ?? undefined,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentReference: row.payment_reference ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
