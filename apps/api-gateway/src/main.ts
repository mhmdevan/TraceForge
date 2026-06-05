import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { getServiceConfig } from "@traceforge/config";
import {
  createRequestLoggingMiddleware,
  isStructuredLoggingEnabled
} from "@traceforge/logger";
import { createMetricsHttpMiddleware } from "@traceforge/metrics";
import { createTraceHttpMiddleware } from "@traceforge/tracing";
import { AppModule, serviceLogger, serviceMetrics, serviceTracer } from "./app.module";

async function bootstrap(): Promise<void> {
  const config = getServiceConfig({
    serviceName: "api-gateway",
    defaultPort: 3000
  });
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
      observabilityMode: config.observabilityMode
    });
  }
}

void bootstrap();
