import { describe, expect, it } from "vitest";
import {
  PaymentAuthorizationResponse,
  TransactionCreatedEvent,
  TransactionResponse
} from "@traceforge/contracts";
import { TransactionsService } from "./transactions.service";
import {
  PaymentClient,
  TransactionCache,
  TransactionEventPublisher,
  TransactionRepository
} from "./transaction-ports";

describe("transactions service", () => {
  it("stores, authorizes, caches, and publishes a created transaction", async () => {
    const repository = new InMemoryRepository();
    const cache = new InMemoryCache();
    const payment = new ApprovedPaymentClient();
    const publisher = new InMemoryPublisher();
    const service = new TransactionsService(repository, cache, payment, publisher);

    const result = await service.createTransaction({
      userId: "user-1",
      amount: 100,
      currency: "USD"
    });

    expect(result.transaction.status).toBe("approved");
    expect(result.transaction.paymentReference).toBe("pay_txn_1");
    await expect(cache.getTransaction("txn_1")).resolves.toMatchObject({
      id: "txn_1",
      status: "approved"
    });
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]).toMatchObject({
      type: "transaction.created",
      transactionId: "txn_1",
      userId: "user-1"
    });
  });

  it("loads a transaction from the repository and warms cache on cache miss", async () => {
    const repository = new InMemoryRepository();
    const cache = new InMemoryCache();
    const service = new TransactionsService(
      repository,
      cache,
      new ApprovedPaymentClient(),
      new InMemoryPublisher()
    );

    await service.createTransaction({
      userId: "user-1",
      amount: 100,
      currency: "USD"
    });
    cache.clear();

    await expect(service.getTransaction("txn_1")).resolves.toMatchObject({
      id: "txn_1"
    });
    await expect(cache.getTransaction("txn_1")).resolves.toMatchObject({
      id: "txn_1"
    });
  });
});

class InMemoryRepository implements TransactionRepository {
  private transaction: TransactionResponse | null = null;

  async createPendingTransaction(): Promise<TransactionResponse> {
    const now = "2026-06-02T00:00:00.000Z";

    this.transaction = {
      id: "txn_1",
      userId: "user-1",
      amount: 100,
      currency: "USD",
      status: "pending",
      paymentStatus: "pending",
      createdAt: now,
      updatedAt: now
    };

    return this.transaction;
  }

  async markPaymentResult(
    _transactionId: string,
    payment: PaymentAuthorizationResponse
  ): Promise<TransactionResponse> {
    this.transaction = {
      ...this.transaction!,
      status: payment.status,
      paymentStatus: payment.status,
      paymentReference: payment.providerReference
    };

    return this.transaction;
  }

  async markPaymentFailed(): Promise<TransactionResponse> {
    this.transaction = {
      ...this.transaction!,
      status: "failed",
      paymentStatus: "failed"
    };

    return this.transaction;
  }

  async findTransactionById(): Promise<TransactionResponse | null> {
    return this.transaction;
  }

  async findTransactionsByUserId(): Promise<TransactionResponse[]> {
    return this.transaction ? [this.transaction] : [];
  }
}

class InMemoryCache implements TransactionCache {
  private readonly cache = new Map<string, TransactionResponse>();

  async getTransaction(transactionId: string): Promise<TransactionResponse | null> {
    return this.cache.get(transactionId) ?? null;
  }

  async setTransaction(transaction: TransactionResponse): Promise<void> {
    this.cache.set(transaction.id, transaction);
  }

  clear(): void {
    this.cache.clear();
  }
}

class ApprovedPaymentClient implements PaymentClient {
  async authorize(): Promise<PaymentAuthorizationResponse> {
    return {
      transactionId: "txn_1",
      status: "approved",
      providerReference: "pay_txn_1",
      authorizedAt: "2026-06-02T00:00:01.000Z"
    };
  }
}

class InMemoryPublisher implements TransactionEventPublisher {
  readonly events: TransactionCreatedEvent[] = [];

  async publishTransactionCreated(event: TransactionCreatedEvent): Promise<void> {
    this.events.push(event);
  }
}
