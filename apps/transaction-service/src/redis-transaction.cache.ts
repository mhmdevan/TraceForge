import { OnModuleDestroy } from "@nestjs/common";
import { RedisFaultConfig } from "@traceforge/config";
import { TransactionResponse } from "@traceforge/contracts";
import {
  MetricsRegistry,
  createNoopMetricsRegistry,
  timeAsync
} from "@traceforge/metrics";
import { ServiceTracer, createNoopServiceTracer } from "@traceforge/tracing";
import { createClient } from "redis";
import { TransactionCache } from "./transaction-ports";

type RedisClient = ReturnType<typeof createClient>;

const NORMAL_FAULTS: RedisFaultConfig = {
  disabled: false,
  timeoutRate: 0,
  timeoutMs: 0
};

export class RedisTransactionCache implements TransactionCache, OnModuleDestroy {
  private client: RedisClient | null = null;

  constructor(
    private readonly redisUrl: string,
    private readonly ttlSeconds: number,
    private readonly metrics: MetricsRegistry = createNoopMetricsRegistry(),
    private readonly tracer: ServiceTracer = createNoopServiceTracer(),
    private readonly faults: RedisFaultConfig = NORMAL_FAULTS,
    private readonly random: () => number = Math.random
  ) {}

  async getTransaction(transactionId: string): Promise<TransactionResponse | null> {
    // When Redis is "unavailable" the read path degrades to a cache miss so the
    // request falls through to PostgreSQL (the F5 cache-miss-plus-latency symptom).
    if (this.faults.disabled) {
      return null;
    }

    await this.injectLatency();
    const client = await this.getClient();
    const value = await this.tracer.withSpan(
      "redis.get_transaction",
      () =>
        timeAsync(
          (durationMs) =>
            this.metrics.recordRedisOperation("get_transaction", durationMs),
          () => client.get(cacheKey(transactionId))
        ),
      {
        kind: "client",
        attributes: {
          "db.system.name": "redis",
          "db.operation.name": "get_transaction"
        }
      }
    );

    return value ? (JSON.parse(value) as TransactionResponse) : null;
  }

  async setTransaction(transaction: TransactionResponse): Promise<void> {
    if (this.faults.disabled) {
      return;
    }

    await this.injectLatency();
    const client = await this.getClient();
    await this.tracer.withSpan(
      "redis.set_transaction",
      () =>
        timeAsync(
          (durationMs) =>
            this.metrics.recordRedisOperation("set_transaction", durationMs),
          () =>
            client.set(cacheKey(transaction.id), JSON.stringify(transaction), {
              EX: this.ttlSeconds
            })
        ),
      {
        kind: "client",
        attributes: {
          "db.system.name": "redis",
          "db.operation.name": "set_transaction"
        }
      }
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  // A configurable fraction of cache operations pause to simulate a slow or
  // flaky Redis, adding latency without taking the cache fully offline.
  private async injectLatency(): Promise<void> {
    if (this.faults.timeoutMs > 0 && this.random() < this.faults.timeoutRate) {
      await sleep(this.faults.timeoutMs);
    }
  }

  private async getClient(): Promise<RedisClient> {
    if (this.client?.isOpen) {
      return this.client;
    }

    this.client = createClient({
      url: this.redisUrl
    });
    await this.client.connect();

    return this.client;
  }
}

function cacheKey(transactionId: string): string {
  return `transaction:${transactionId}`;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
