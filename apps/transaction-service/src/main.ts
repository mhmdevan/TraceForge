import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { getMemoryPressureConfig, getServiceConfig } from "@traceforge/config";
import {
  createRequestLoggingMiddleware,
  isStructuredLoggingEnabled
} from "@traceforge/logger";
import { createMetricsHttpMiddleware } from "@traceforge/metrics";
import { createTraceHttpMiddleware } from "@traceforge/tracing";
import { AppModule, serviceLogger, serviceMetrics, serviceTracer } from "./app.module";
import { startMemoryPressure } from "./memory-pressure";

async function bootstrap(): Promise<void> {
  const config = getServiceConfig({
    serviceName: "transaction-service",
    defaultPort: 3001
  });
  const memoryPressure = startMemoryPressure(getMemoryPressureConfig());
  const app = await NestFactory.create(AppModule, {
    logger: false
  });

  app.use(createTraceHttpMiddleware(serviceTracer));
  app.use(
    createRequestLoggingMiddleware({
      logger: serviceLogger,
      observabilityMode: config.observabilityMode
    })
  );
  app.use(createMetricsHttpMiddleware(serviceMetrics));
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);

  if (isStructuredLoggingEnabled(config.observabilityMode)) {
    serviceLogger.info("service.started", {
      host: config.host,
      port: config.port,
      observabilityMode: config.observabilityMode,
      memory_pressure_mb: memoryPressure.allocatedMb()
    });
  }
}

void bootstrap();
