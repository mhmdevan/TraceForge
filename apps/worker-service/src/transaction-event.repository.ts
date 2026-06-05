import { TransactionCreatedEvent } from "@traceforge/contracts";

export interface TransactionEventRepository {
  persistTransactionCreatedEvent(event: TransactionCreatedEvent): Promise<void>;
}
