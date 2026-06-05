import { Module } from "@nestjs/common";
import {
  getRuntimeConfig,
  getServiceConfig,
  getTelemetryConfig,
  getWorkerFaultConfig
} from "@traceforge/config";
import { createLogger } from "@traceforge/logger";
import { createPrometheusMetricsRegistry } from "@traceforge/metrics";
import {
  createOpenTelemetryTracer,
  startOpenTelemetryTracing
} from "@traceforge/tracing";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { PgTransactionEventRepository } from "./pg-transaction-event.repository";
import { SERVICE_CONFIG, TRANSACTION_EVENT_REPOSITORY } from "./service.constants";
import { RabbitMqTransactionEventConsumer } from "./transaction-event.consumer";
import { TransactionEventRepository } from "./transaction-event.repository";

const serviceConfig = getServiceConfig({
  serviceName: "worker-service",
  defaultPort: 3003
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
  controllers: [HealthController],
  providers: [
    {
      provide: SERVICE_CONFIG,
      useValue: serviceConfig
    },
    {
      provide: TRANSACTION_EVENT_REPOSITORY,
      useValue: new PgTransactionEventRepository(
        runtimeConfig.databaseUrl,
        serviceMetrics,
        serviceTracer
      )
    },
    {
      provide: RabbitMqTransactionEventConsumer,
      useFactory: (repository: TransactionEventRepository) =>
        new RabbitMqTransactionEventConsumer(
          repository,
          runtimeConfig.rabbitMqUrl,
          runtimeConfig.transactionEventsQueue,
          serviceMetrics,
          serviceLogger,
          serviceTracer,
          getWorkerFaultConfig()
        ),
      inject: [TRANSACTION_EVENT_REPOSITORY]
    },
    HealthService
  ]
})
export class AppModule {}
