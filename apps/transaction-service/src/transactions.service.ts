import { Inject, Injectable } from "@nestjs/common";
import {
  CreateTransactionRequest,
  CreateTransactionResponse,
  TransactionCreatedEvent,
  TransactionHistoryResponse,
  TransactionResponse
} from "@traceforge/contracts";
import { Logger, createNoopLogger } from "@traceforge/logger";
import { randomUUID } from "node:crypto";
import {
  PAYMENT_CLIENT,
  TRANSACTION_CACHE,
  TRANSACTION_EVENT_PUBLISHER,
  TRANSACTION_REPOSITORY
} from "./service.constants";
import {
  PaymentClient,
  TransactionCache,
  TransactionEventPublisher,
  TransactionRepository
} from "./transaction-ports";

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(TRANSACTION_REPOSITORY)
    private readonly repository: TransactionRepository,
    @Inject(TRANSACTION_CACHE)
    private readonly cache: TransactionCache,
    @Inject(PAYMENT_CLIENT)
    private readonly paymentClient: PaymentClient,
    @Inject(TRANSACTION_EVENT_PUBLISHER)
    private readonly eventPublisher: TransactionEventPublisher,
    private readonly logger: Logger = createNoopLogger()
  ) {}

  async createTransaction(
    request: CreateTransactionRequest
  ): Promise<CreateTransactionResponse> {
    const pending = await this.repository.createPendingTransaction(request);

    let transaction: TransactionResponse;

    try {
      const payment = await this.paymentClient.authorize(
        {
          transactionId: pending.id,
          userId: pending.userId,
          amount: pending.amount,
          currency: pending.currency
        },
        {
          simulatedDelayMs: paymentDelayFor(request)
        }
      );

      transaction = await this.repository.markPaymentResult(pending.id, payment);
      this.logger.info("transaction.payment_authorized", {
        transaction_id: transaction.id,
        user_id: transaction.userId,
        amount: transaction.amount,
        currency: transaction.currency,
        payment_status: transaction.paymentStatus
      });
    } catch (error) {
      transaction = await this.repository.markPaymentFailed(pending.id);
      this.logger.error("transaction.payment_failed", {
        transaction_id: transaction.id,
        user_id: transaction.userId,
        amount: transaction.amount,
        currency: transaction.currency,
        error: error instanceof Error ? error.message : "unknown"
      });
      throw error;
    }

    await this.cache.setTransaction(transaction);
    await this.eventPublisher.publishTransactionCreated(
      createTransactionCreatedEvent(transaction)
    );
    this.logger.info("transaction.created", {
      transaction_id: transaction.id,
      user_id: transaction.userId,
      amount: transaction.amount,
      currency: transaction.currency,
      status: transaction.status
    });

    return {
      transaction
    };
  }

  async getTransaction(transactionId: string): Promise<TransactionResponse | null> {
    const cached = await this.cache.getTransaction(transactionId);

    if (cached) {
      this.logger.info("transaction.cache_hit", {
        transaction_id: transactionId
      });
      return cached;
    }

    this.logger.info("transaction.cache_miss", {
      transaction_id: transactionId
    });
    const transaction = await this.repository.findTransactionById(transactionId);

    if (transaction) {
      await this.cache.setTransaction(transaction);
    }

    return transaction;
  }

  async getUserTransactions(userId: string): Promise<TransactionHistoryResponse> {
    return {
      transactions: await this.repository.findTransactionsByUserId(userId)
    };
  }
}

function paymentDelayFor(request: CreateTransactionRequest): number | undefined {
  return request.description === "slow-payment" ? 150 : undefined;
}

function createTransactionCreatedEvent(
  transaction: TransactionResponse
): TransactionCreatedEvent {
  return {
    id: randomUUID(),
    type: "transaction.created",
    transactionId: transaction.id,
    userId: transaction.userId,
    amount: transaction.amount,
    currency: transaction.currency,
    status: transaction.status,
    occurredAt: new Date().toISOString()
  };
}
