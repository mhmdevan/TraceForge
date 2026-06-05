import { OnModuleDestroy } from "@nestjs/common";
import { TransactionCreatedEvent } from "@traceforge/contracts";
import {
  CORRELATION_ID_HEADER,
  Logger,
  createNoopLogger,
  getCorrelationId
} from "@traceforge/logger";
import {
  MetricsRegistry,
  createNoopMetricsRegistry,
  timeAsync
} from "@traceforge/metrics";
import { ServiceTracer, createNoopServiceTracer } from "@traceforge/tracing";
import { Channel, ChannelModel, connect } from "amqplib";
import { TransactionEventPublisher } from "./transaction-ports";

export class RabbitMqTransactionEventPublisher
  implements TransactionEventPublisher, OnModuleDestroy
{
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  constructor(
    private readonly rabbitMqUrl: string,
    private readonly queueName: string,
    private readonly metrics: MetricsRegistry = createNoopMetricsRegistry(),
    private readonly logger: Logger = createNoopLogger(),
    private readonly tracer: ServiceTracer = createNoopServiceTracer()
  ) {}

  async publishTransactionCreated(event: TransactionCreatedEvent): Promise<void> {
    const channel = await this.getChannel();
    const body = Buffer.from(JSON.stringify(event));
    const correlationId = getCorrelationId();

    await this.tracer.withSpan(
      "rabbitmq.publish transaction.events",
      async () =>
        timeAsync(
          (durationMs) => this.metrics.recordRabbitMqPublish(this.queueName, durationMs),
          async () => {
            const headers = {
              ...(correlationId ? { [CORRELATION_ID_HEADER]: correlationId } : {}),
              ...this.tracer.getTraceHeaders()
            };

            channel.sendToQueue(this.queueName, body, {
              contentType: "application/json",
              persistent: true,
              messageId: event.id,
              timestamp: Date.parse(event.occurredAt),
              headers: Object.keys(headers).length > 0 ? headers : undefined
            });
          }
        ),
      {
        kind: "producer",
        attributes: {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": this.queueName,
          "messaging.operation.name": "publish",
          "messaging.message.id": event.id
        }
      }
    );
    this.logger.info("rabbitmq.message.published", {
      queue: this.queueName,
      message_id: event.id,
      event_type: event.type,
      transaction_id: event.transactionId
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  private async getChannel(): Promise<Channel> {
    if (this.channel) {
      return this.channel;
    }

    const connection = await connect(this.rabbitMqUrl);
    const channel = await connection.createChannel();

    await channel.assertQueue(this.queueName, {
      durable: true
    });

    this.connection = connection;
    this.channel = channel;

    return this.channel;
  }
}
