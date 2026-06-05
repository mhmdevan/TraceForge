import {
  OBSERVABILITY_MODES,
  ObservabilityMode,
  ServiceName
} from "@traceforge/contracts";

export interface ServiceConfig {
  serviceName: ServiceName;
  host: string;
  port: number;
  environment: string;
  version: string;
  observabilityMode: ObservabilityMode;
}

export interface RuntimeConfig {
  databaseUrl: string;
  redisUrl: string;
  rabbitMqUrl: string;
  transactionServiceUrl: string;
  paymentServiceUrl: string;
  transactionEventsQueue: string;
  transactionCacheTtlSeconds: number;
  paymentClientTimeoutMs: number;
}

export interface TelemetryConfig {
  deploymentEnvironment: string;
  otlpEndpoint: string;
  otlpLogsEndpoint: string;
  otlpTraceEndpoint: string;
  traceSamplingRatio: number;
}

export interface ServiceConfigOptions {
  serviceName: ServiceName;
  defaultPort: number;
  env?: NodeJS.ProcessEnv;
}

export function getServiceConfig(options: ServiceConfigOptions): ServiceConfig {
  const env = options.env ?? process.env;
  const serviceSpecificPortKey = `${options.serviceName
    .replaceAll("-", "_")
    .toUpperCase()}_PORT`;

  return {
    serviceName: options.serviceName,
    host: env.HOST ?? "0.0.0.0",
    port: parsePort(env[serviceSpecificPortKey] ?? env.PORT, options.defaultPort),
    environment: env.NODE_ENV ?? "development",
    version: env.SERVICE_VERSION ?? env.npm_package_version ?? "0.1.0",
    observabilityMode: parseObservabilityMode(env.OBS_MODE)
  };
}

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    databaseUrl:
      env.DATABASE_URL ??
      buildPostgresUrl({
        host: env.POSTGRES_HOST ?? "localhost",
        port: parsePort(env.POSTGRES_PORT, 15432),
        database: env.POSTGRES_DB ?? "traceforge",
        user: env.POSTGRES_USER ?? "traceforge",
        password: env.POSTGRES_PASSWORD ?? "traceforge"
      }),
    redisUrl: env.REDIS_URL ?? "redis://localhost:16379",
    rabbitMqUrl: env.RABBITMQ_URL ?? "amqp://localhost:15673",
    transactionServiceUrl: trimTrailingSlash(
      env.TRANSACTION_SERVICE_URL ?? "http://localhost:3001"
    ),
    paymentServiceUrl: trimTrailingSlash(
      env.PAYMENT_SERVICE_URL ?? "http://localhost:3002"
    ),
    transactionEventsQueue: env.TRANSACTION_EVENTS_QUEUE ?? "transaction.events",
    transactionCacheTtlSeconds: parsePort(env.TRANSACTION_CACHE_TTL_SECONDS, 60),
    paymentClientTimeoutMs: parseNonNegativeInt(env.PAYMENT_CLIENT_TIMEOUT_MS, 5000)
  };
}

export function getTelemetryConfig(
  env: NodeJS.ProcessEnv = process.env
): TelemetryConfig {
  const otlpEndpoint = trimTrailingSlash(
    nonEmpty(env.OTEL_EXPORTER_OTLP_ENDPOINT) ?? "http://localhost:4318"
  );

  return {
    deploymentEnvironment: env.DEPLOYMENT_ENVIRONMENT ?? env.NODE_ENV ?? "development",
    otlpEndpoint,
    otlpLogsEndpoint:
      nonEmpty(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) ?? `${otlpEndpoint}/v1/logs`,
    otlpTraceEndpoint:
      nonEmpty(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) ?? `${otlpEndpoint}/v1/traces`,
    traceSamplingRatio: parseRatio(env.OTEL_TRACES_SAMPLER_ARG, 1)
  };
}

// --- Failure injection configuration (Phase 9) --------------------------------
//
// Every fault defaults to "off" so a normally started stack behaves exactly as
// before. Experiments enable a single fault at a time through environment
// variables, following the matrix in docs/failure-injection-protocol.md.

export type PaymentFaultMode = "normal" | "slow" | "error" | "timeout";

export interface PaymentFaultConfig {
  mode: PaymentFaultMode;
  delayMs: number;
  errorRate: number;
  timeoutRate: number;
  timeoutMs: number;
}

export interface DatabaseFaultConfig {
  slowQuery: boolean;
  slowQueryDelayMs: number;
  connectionErrorRate: number;
}

export interface RedisFaultConfig {
  disabled: boolean;
  timeoutRate: number;
  timeoutMs: number;
}

export interface WorkerFaultConfig {
  disabled: boolean;
  processingDelayMs: number;
  errorRate: number;
}

export interface MemoryPressureConfig {
  enabled: boolean;
  initialMb: number;
  leakMbPerMinute: number;
}

export function getPaymentFaultConfig(
  env: NodeJS.ProcessEnv = process.env
): PaymentFaultConfig {
  const mode = parsePaymentFaultMode(env.PAYMENT_MODE);

  return {
    mode,
    // A "slow" mode with no explicit delay still needs a visible delay to be useful.
    delayMs:
      mode === "slow"
        ? parseNonNegativeInt(env.PAYMENT_DELAY_MS, 1000)
        : parseNonNegativeInt(env.PAYMENT_DELAY_MS, 0),
    errorRate: parseRatio(env.PAYMENT_ERROR_RATE, 0),
    timeoutRate: parseRatio(env.PAYMENT_TIMEOUT_RATE, 0),
    timeoutMs: parseNonNegativeInt(env.PAYMENT_TIMEOUT_MS, 10000)
  };
}

export function getDatabaseFaultConfig(
  env: NodeJS.ProcessEnv = process.env
): DatabaseFaultConfig {
  return {
    slowQuery: parseBooleanFlag(env.DB_SLOW_QUERY, false),
    slowQueryDelayMs: parseNonNegativeInt(env.DB_SLOW_QUERY_DELAY_MS, 500),
    connectionErrorRate: parseRatio(env.DB_CONNECTION_ERROR_RATE, 0)
  };
}

export function getRedisFaultConfig(
  env: NodeJS.ProcessEnv = process.env
): RedisFaultConfig {
  return {
    disabled: parseBooleanFlag(env.REDIS_DISABLED, false),
    timeoutRate: parseRatio(env.REDIS_TIMEOUT_RATE, 0),
    timeoutMs: parseNonNegativeInt(env.REDIS_TIMEOUT_MS, 500)
  };
}

export function getWorkerFaultConfig(
  env: NodeJS.ProcessEnv = process.env
): WorkerFaultConfig {
  return {
    disabled: parseBooleanFlag(env.WORKER_DISABLED, false),
    processingDelayMs: parseNonNegativeInt(env.WORKER_PROCESSING_DELAY_MS, 0),
    errorRate: parseRatio(env.WORKER_ERROR_RATE, 0)
  };
}

export function getMemoryPressureConfig(
  env: NodeJS.ProcessEnv = process.env
): MemoryPressureConfig {
  return {
    enabled: parseBooleanFlag(env.MEMORY_PRESSURE_ENABLED, false),
    initialMb: parseNonNegativeInt(env.MEMORY_PRESSURE_MB, 0),
    leakMbPerMinute: parseNonNegativeInt(env.MEMORY_PRESSURE_LEAK_MB_PER_MIN, 0)
  };
}

export function parseObservabilityMode(value: string | undefined): ObservabilityMode {
  if (!value) {
    return "none";
  }

  if (OBSERVABILITY_MODES.includes(value as ObservabilityMode)) {
    return value as ObservabilityMode;
  }

  throw new Error(
    `Invalid OBS_MODE "${value}". Expected one of: ${OBSERVABILITY_MODES.join(", ")}`
  );
}

function parseRatio(value: string | undefined, fallback: number): number {
  const ratio = Number(value ?? fallback);

  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error(`Invalid ratio "${value ?? fallback}"`);
  }

  return ratio;
}

function parsePort(value: string | undefined, fallback: number): number {
  const port = Number.parseInt(value ?? `${fallback}`, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid service port "${value ?? fallback}"`);
  }

  return port;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? `${fallback}`, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative integer "${value ?? fallback}"`);
  }

  return parsed;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePaymentFaultMode(value: string | undefined): PaymentFaultMode {
  if (!value) {
    return "normal";
  }

  const modes: PaymentFaultMode[] = ["normal", "slow", "error", "timeout"];

  if (modes.includes(value as PaymentFaultMode)) {
    return value as PaymentFaultMode;
  }

  throw new Error(
    `Invalid PAYMENT_MODE "${value}". Expected one of: ${modes.join(", ")}`
  );
}

function buildPostgresUrl(options: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): string {
  const user = encodeURIComponent(options.user);
  const password = encodeURIComponent(options.password);
  const database = encodeURIComponent(options.database);

  return `postgres://${user}:${password}@${options.host}:${options.port}/${database}`;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
