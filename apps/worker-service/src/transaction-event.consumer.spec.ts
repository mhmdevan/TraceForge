import { describe, expect, it } from "vitest";
import { TransactionCreatedEvent } from "@traceforge/contracts";
import { RabbitMqTransactionEventConsumer } from "./transaction-event.consumer";
import { TransactionEventRepository } from "./transaction-event.repository";

describe("transaction event consumer", () => {
  it("persists a transaction.created message body", async () => {
    const repository = new InMemoryEventRepository();
    const consumer = new RabbitMqTransactionEventConsumer(
      repository,
      "amqp://localhost:5672",
      "transaction.events"
    );
    const event: TransactionCreatedEvent = {
      id: "event-1",
      type: "transaction.created",
      transactionId: "txn_1",
      userId: "user-1",
      amount: 100,
      currency: "USD",
      status: "approved",
      occurredAt: "2026-06-02T00:00:00.000Z"
    };

    await consumer.handleMessageBody(JSON.stringify(event));

    expect(repository.events).toEqual([event]);
  });

  it("throws when the worker error fault is active", async () => {
    const repository = new InMemoryEventRepository();
    const consumer = new RabbitMqTransactionEventConsumer(
      repository,
      "amqp://localhost:5672",
      "transaction.events",
      undefined,
      undefined,
      undefined,
      { disabled: false, processingDelayMs: 0, errorRate: 1 },
      () => 0
    );
    const event: TransactionCreatedEvent = {
      id: "event-2",
      type: "transaction.created",
      transactionId: "txn_2",
      userId: "user-1",
      amount: 100,
      currency: "USD",
      status: "approved",
      occurredAt: "2026-06-02T00:00:00.000Z"
    };

    await expect(consumer.handleMessageBody(JSON.stringify(event))).rejects.toThrow(
      /injected worker processing error/
    );
    expect(repository.events).toEqual([]);
  });
});

class InMemoryEventRepository implements TransactionEventRepository {
  readonly events: TransactionCreatedEvent[] = [];

  async persistTransactionCreatedEvent(event: TransactionCreatedEvent): Promise<void> {
    this.events.push(event);
  }
}
