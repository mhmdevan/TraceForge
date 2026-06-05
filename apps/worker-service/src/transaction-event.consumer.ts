import { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { WorkerFaultConfig } from "@traceforge/config";
import { TransactionCreatedEvent } from "@traceforge/contracts";
import {
  CORRELATION_ID_HEADER,
  Logger,
  createCorrelationId,
  createNoopLogger,
  normalizeCorrelationId,
  runWithCorrelationId
} from "@traceforge/logger";
import {
  MetricsRegistry,
  createNoopMetricsRegistry,
  timeAsync
} from "@traceforge/metrics";
import { ServiceTracer, createNoopServiceTracer } from "@traceforge/tracing";
import { Channel, ChannelModel, connect, ConsumeMessage } from "amqplib";
import { TransactionEventRepository } from "./transaction-event.repository";

const NORMAL_FAULTS: WorkerFaultConfig = {
  disabled: false,
  processingDelayMs: 0,
  errorRate: 0
};

export class RabbitMqTransactionEventConsumer implements OnModuleInit, OnModuleDestroy {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  constructor(
    private readonly repository: TransactionEventRepository,
    private readonly rabbitMqUrl: string,
    private readonly queueName: string,
    private readonly metrics: MetricsRegistry = createNoopMetricsRegistry(),
    private readonly logger: Logger = createNoopLogger(),
    private readonly tracer: ServiceTracer = createNoopServiceTracer(),
    private readonly faults: WorkerFaultConfig = NORMAL_FAULTS,
    private readonly random: () => number = Math.random
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = await connect(this.rabbitMqUrl);
    const channel = await connection.createChannel();

    await channel.assertQueue(this.queueName, {
      durable: true
    });

    // A disabled worker still declares the queue but never consumes, so published
    // events accumulate and queue lag grows (the F4 RabbitMQ-consumer-stopped symptom).
    if (this.faults.disabled) {
      this.logger.warn("worker.disabled", {
        queue: this.queueName
      });
    } else {
      await channel.consume(this.queueName, (message) => {
        void this.consumeMessage(message);
      });
    }

    this.connection = connection;
    this.channel = channel;
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  async handleMessageBody(body: string, correlationId?: string): Promise<void> {
    await runWithCorrelationId(correlationId ?? createCorrelationId(), async () => {
      await this.tracer.withSpan(
        "rabbitmq.consume transaction.events",
        () =>
          timeAsync(
            (durationMs) =>
              this.metrics.recordRabbitMqConsume(this.queueName, durationMs),
            async () => {
              if (this.faults.processingDelayMs > 0) {
                await sleep(this.faults.processingDelayMs);
              }

              if (this.random() < this.faults.errorRate) {
                throw new Error("injected worker processing error");
              }

              const event = parseTransactionCreatedEvent(body);
              await this.repository.persistTransactionCreatedEvent(event);
              this.logger.info("rabbitmq.message.consumed", {
                queue: this.queueName,
                message_id: event.id,
                event_type: event.type,
                transaction_id: event.transactionId
              });
            }
          ),
        {
          kind: "consumer",
          attributes: {
            "messaging.system": "rabbitmq",
            "messaging.destination.name": this.queueName,
            "messaging.operation.name": "consume"
          }
        }
      );
    });
  }

  private async consumeMessage(message: ConsumeMessage | null): Promise<void> {
    if (!message || !this.channel) {
      return;
    }

    try {
      await this.tracer.runWithExtractedTrace(readMessageHeaders(message), async () =>
        this.handleMessageBody(
          message.content.toString("utf8"),
          readMessageCorrelationId(message)
        )
      );
      this.channel.ack(message);
    } catch (error) {
      const correlationId = readMessageCorrelationId(message) ?? createCorrelationId();
      this.tracer.runWithExtractedTrace(readMessageHeaders(message), () => {
        runWithCorrelationId(correlationId, () => {
          this.logger.error("rabbitmq.message.failed", {
            queue: this.queueName,
            message_id: message.properties.messageId,
            error: error instanceof Error ? error.message : "unknown"
          });
        });
      });
      this.channel.nack(message, false, false);
    }
  }
}

function readMessageCorrelationId(message: ConsumeMessage): string | undefined {
  return normalizeCorrelationId(message.properties.headers?.[CORRELATION_ID_HEADER]);
}

function readMessageHeaders(
  message: ConsumeMessage
): Record<string, unknown> | undefined {
  return message.properties.headers as Record<string, unknown> | undefined;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function parseTransactionCreatedEvent(body: string): TransactionCreatedEvent {
  const value = JSON.parse(body) as Partial<TransactionCreatedEvent>;

  if (
    value.type !== "transaction.created" ||
    typeof value.id !== "string" ||
    typeof value.transactionId !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.amount !== "number" ||
    typeof value.currency !== "string" ||
    typeof value.status !== "string" ||
    typeof value.occurredAt !== "string"
  ) {
    throw new Error("Invalid transaction.created event.");
  }

  return value as TransactionCreatedEvent;
}
