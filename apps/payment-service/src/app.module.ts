import { Module } from "@nestjs/common";
import {
  getPaymentFaultConfig,
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
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { SERVICE_CONFIG } from "./service.constants";

const serviceConfig = getServiceConfig({
  serviceName: "payment-service",
  defaultPort: 3002
});
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
  controllers: [HealthController, PaymentsController],
  providers: [
    {
      provide: SERVICE_CONFIG,
      useValue: serviceConfig
    },
    {
      provide: PaymentsService,
      useValue: new PaymentsService(serviceLogger, serviceTracer, getPaymentFaultConfig())
    },
    HealthService
  ]
})
export class AppModule {}
