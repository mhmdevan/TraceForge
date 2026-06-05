import {
  CreateTransactionRequest,
  PaymentAuthorizationRequest,
  PaymentAuthorizationResponse,
  TransactionCreatedEvent,
  TransactionResponse
} from "@traceforge/contracts";

export interface TransactionRepository {
  createPendingTransaction(
    request: CreateTransactionRequest
  ): Promise<TransactionResponse>;
  markPaymentResult(
    transactionId: string,
    payment: PaymentAuthorizationResponse
  ): Promise<TransactionResponse>;
  markPaymentFailed(transactionId: string): Promise<TransactionResponse>;
  findTransactionById(transactionId: string): Promise<TransactionResponse | null>;
  findTransactionsByUserId(userId: string): Promise<TransactionResponse[]>;
}

export interface TransactionCache {
  getTransaction(transactionId: string): Promise<TransactionResponse | null>;
  setTransaction(transaction: TransactionResponse): Promise<void>;
}

export interface PaymentClient {
  authorize(
    request: PaymentAuthorizationRequest,
    options?: {
      simulatedDelayMs?: number;
    }
  ): Promise<PaymentAuthorizationResponse>;
}

export interface TransactionEventPublisher {
  publishTransactionCreated(event: TransactionCreatedEvent): Promise<void>;
}
