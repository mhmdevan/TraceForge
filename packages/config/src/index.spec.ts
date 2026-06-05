import { describe, expect, it } from "vitest";
import {
  getDatabaseFaultConfig,
  getPaymentFaultConfig,
  getRedisFaultConfig,
  getRuntimeConfig,
  getServiceConfig,
  getTelemetryConfig,
  getWorkerFaultConfig,
  parseObservabilityMode
} from "./index";

describe("config", () => {
  it("uses the default port when no port is provided", () => {
    const config = getServiceConfig({
      serviceName: "api-gateway",
      defaultPort: 3000,
      env: {}
    });

    expect(config.port).toBe(3000);
    expect(config.observabilityMode).toBe("none");
  });

  it("prefers service-specific ports over generic PORT", () => {
    const config = getServiceConfig({
      serviceName: "payment-service",
      defaultPort: 3002,
      env: {
        PORT: "9000",
        PAYMENT_SERVICE_PORT: "3102"
      }
    });

    expect(config.port).toBe(3102);
  });

  it("rejects unsupported observability modes", () => {
    expect(() => parseObservabilityMode("verbose")).toThrow(/Invalid OBS_MODE/);
  });

  it("builds runtime defaults for phase-two infrastructure", () => {
    const config = getRuntimeConfig({});

    expect(config.databaseUrl).toBe(
      "postgres://traceforge:traceforge@localhost:15432/traceforge"
    );
    expect(config.redisUrl).toBe("redis://localhost:16379");
    expect(config.rabbitMqUrl).toBe("amqp://localhost:15673");
    expect(config.transactionEventsQueue).toBe("transaction.events");
  });

  it("builds OpenTelemetry endpoint defaults from the OTLP base endpoint", () => {
    const config = getTelemetryConfig({
      NODE_ENV: "test",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4318/",
      OTEL_TRACES_SAMPLER_ARG: "0.25"
    });

    expect(config.deploymentEnvironment).toBe("test");
    expect(config.otlpTraceEndpoint).toBe("http://otel-collector:4318/v1/traces");
    expect(config.otlpLogsEndpoint).toBe("http://otel-collector:4318/v1/logs");
    expect(config.traceSamplingRatio).toBe(0.25);
  });

  it("defaults every failure injection flag to off", () => {
    expect(getPaymentFaultConfig({})).toEqual({
      mode: "normal",
      delayMs: 0,
      errorRate: 0,
      timeoutRate: 0,
      timeoutMs: 10000
    });
    expect(getDatabaseFaultConfig({})).toEqual({
      slowQuery: false,
      slowQueryDelayMs: 500,
      connectionErrorRate: 0
    });
    expect(getRedisFaultConfig({})).toEqual({
      disabled: false,
      timeoutRate: 0,
      timeoutMs: 500
    });
    expect(getWorkerFaultConfig({})).toEqual({
      disabled: false,
      processingDelayMs: 0,
      errorRate: 0
    });
  });

  it("parses payment fault flags and gives slow mode a default delay", () => {
    expect(getPaymentFaultConfig({ PAYMENT_MODE: "slow" }).delayMs).toBe(1000);
    expect(
      getPaymentFaultConfig({ PAYMENT_MODE: "error", PAYMENT_ERROR_RATE: "0.2" })
    ).toMatchObject({ mode: "error", errorRate: 0.2 });
  });

  it("rejects invalid payment modes and out-of-range rates", () => {
    expect(() => getPaymentFaultConfig({ PAYMENT_MODE: "boom" })).toThrow(
      /Invalid PAYMENT_MODE/
    );
    expect(() => getPaymentFaultConfig({ PAYMENT_ERROR_RATE: "5" })).toThrow();
  });

  it("treats common truthy strings as enabled flags", () => {
    expect(getRedisFaultConfig({ REDIS_DISABLED: "true" }).disabled).toBe(true);
    expect(getWorkerFaultConfig({ WORKER_DISABLED: "1" }).disabled).toBe(true);
    expect(getDatabaseFaultConfig({ DB_SLOW_QUERY: "off" }).slowQuery).toBe(false);
  });
});
