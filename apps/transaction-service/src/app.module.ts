import { Module } from "@nestjs/common";
import {
  getDatabaseFaultConfig,
  getRedisFaultConfig,
  getRuntimeConfig,
  getServiceConfig,
  getTelemetryConfig
} from "@traceforge/config";
import { createLogger } from "@traceforge/logger";
import { createPrometheusMetricsRegistry } from "@traceforge/metrics";
import {
  createOpenTelemetryTracer,
  startOpenTelemetryTracing
} from "@traceforge/tracing";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { PaymentHttpClient } from "./payment-http.client";
import { PgTransactionRepository } from "./pg-transaction.repository";
import { RedisTransactionCache } from "./redis-transaction.cache";
import {
  PAYMENT_CLIENT,
  SERVICE_CONFIG,
  TRANSACTION_CACHE,
  TRANSACTION_EVENT_PUBLISHER,
  TRANSACTION_REPOSITORY
} from "./service.constants";
import { RabbitMqTransactionEventPublisher } from "./transaction-event.publisher";
import { TransactionsController } from "./transactions.controller";
import { TransactionsService } from "./transactions.service";
import {
  PaymentClient,
  TransactionCache,
  TransactionEventPublisher,
  TransactionRepository
} from "./transaction-ports";

const serviceConfig = getServiceConfig({
  serviceName: "transaction-service",
  defaultPort: 3001
});
const runtimeConfig = getRuntimeConfig();
const telemetryConfig = getTelemetryConfig();
export const tracingRuntime = startOpenTelemetryTracing({
  serviceName: serviceConfig.serviceName,
  serviceVersion: serviceConfig.version,
  deploymentEnvironment: telemetryConfig.deploymentEnvironment,
  observabilityMode: serviceConfig.observabilityMode,
  otlpTraceEndpoint: telemetryConfig.otlpTraceEndpoint,
  samplingRatio: telemetryConfig.traceSamplingRatio
});
export const serviceTracer = createOpenTelemetryTracer({
  serviceName: serviceConfig.serviceName,
  observabilityMode: serviceConfig.observabilityMode
});
export const serviceMetrics = createPrometheusMetricsRegistry({
  serviceName: serviceConfig.serviceName,
  observabilityMode: serviceConfig.observabilityMode
});
export const serviceLogger = createLogger({
  serviceName: serviceConfig.serviceName,
  serviceVersion: serviceConfig.version,
  deploymentEnvironment: telemetryConfig.deploymentEnvironment,
  observabilityMode: serviceConfig.observabilityMode,
  lokiPushUrl: process.env.LOKI_PUSH_URL,
  otlpLogsEndpoint: telemetryConfig.otlpLogsEndpoint,
  traceIdProvider: () => serviceTracer.getCurrentTraceId()
});

@Module({
  controllers: [HealthController, TransactionsController],
  providers: [
    {
      provide: SERVICE_CONFIG,
      useValue: serviceConfig
    },
    {
      provide: TRANSACTION_REPOSITORY,
      useValue: new PgTransactionRepository(
        runtimeConfig.databaseUrl,
        serviceMetrics,
        serviceTracer,
        getDatabaseFaultConfig()
      )
    },
    {
      provide: TRANSACTION_CACHE,
      useValue: new RedisTransactionCache(
        runtimeConfig.redisUrl,
        runtimeConfig.transactionCacheTtlSeconds,
        serviceMetrics,
        serviceTracer,
        getRedisFaultConfig()
      )
    },
    {
      provide: PAYMENT_CLIENT,
      useValue: new PaymentHttpClient(
        runtimeConfig.paymentServiceUrl,
        fetch,
        serviceLogger,
        serviceTracer,
        runtimeConfig.paymentClientTimeoutMs
      )
    },
    {
      provide: TRANSACTION_EVENT_PUBLISHER,
      useValue: new RabbitMqTransactionEventPublisher(
        runtimeConfig.rabbitMqUrl,
        runtimeConfig.transactionEventsQueue,
        serviceMetrics,
        serviceLogger,
        serviceTracer
      )
    },
    {
      provide: TransactionsService,
      useFactory: (
        repository: TransactionRepository,
        cache: TransactionCache,
        paymentClient: PaymentClient,
        eventPublisher: TransactionEventPublisher
      ) =>
        new TransactionsService(
          repository,
          cache,
          paymentClient,
          eventPublisher,
          serviceLogger
        ),
      inject: [
        TRANSACTION_REPOSITORY,
        TRANSACTION_CACHE,
        PAYMENT_CLIENT,
        TRANSACTION_EVENT_PUBLISHER
      ]
    },
    HealthService
  ]
})
export class AppModule {}
