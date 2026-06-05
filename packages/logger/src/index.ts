import { ServiceName } from "@traceforge/contracts";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: ServiceName;
  message: string;
  correlation_id?: string;
  trace_id?: string;
  context?: Record<string, unknown>;
}

export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  serviceName: ServiceName;
  serviceVersion?: string;
  deploymentEnvironment?: string;
  observabilityMode?: string;
  lokiPushUrl?: string;
  otlpLogsEndpoint?: string;
  traceIdProvider?: () => string | undefined;
  sink?: LogSink;
}

export const CORRELATION_ID_HEADER = "x-correlation-id";

type CorrelationContext = {
  correlationId: string;
};

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? defaultSink;
  const pushToLoki = createLokiPusher(options.lokiPushUrl);
  const pushToOtlpLogs = createOtlpLogsPusher({
    endpoint: options.otlpLogsEndpoint,
    serviceName: options.serviceName,
    serviceVersion: options.serviceVersion ?? "0.1.0",
    deploymentEnvironment: options.deploymentEnvironment ?? "development"
  });

  const write = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    const correlationId = contextCorrelationId(context) ?? getCorrelationId();
    const traceId = contextTraceId(context) ?? options.traceIdProvider?.();
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: options.serviceName,
      message,
      ...(correlationId ? { correlation_id: correlationId } : {}),
      ...(traceId ? { trace_id: traceId } : {}),
      ...(context ? { context: stripCorrelationContext(context) } : {})
    };

    sink(entry);

    if (!isStructuredLoggingEnabled(options.observabilityMode)) {
      return;
    }

    if (isFullOpenTelemetryMode(options.observabilityMode) && pushToOtlpLogs) {
      pushToOtlpLogs(entry);
      return;
    }

    if (pushToLoki) {
      pushToLoki(entry);
    }
  };

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context)
  };
}

export function createNoopLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}

export function isStructuredLoggingEnabled(mode: string | undefined): boolean {
  return (
    mode === "metrics_logs" || mode === "metrics_logs_traces" || mode === "otel_full"
  );
}

export function isFullOpenTelemetryMode(mode: string | undefined): boolean {
  return mode === "otel_full";
}

export function createCorrelationId(): string {
  return randomUUID();
}

export function normalizeCorrelationId(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return normalizeCorrelationId(value[0]);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 128) : undefined;
}

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}

export function runWithCorrelationId<T>(correlationId: string, work: () => T): T {
  return correlationStorage.run({ correlationId }, work);
}

export function getCorrelationHeaders(): Record<string, string> {
  const correlationId = getCorrelationId();
  return correlationId ? { [CORRELATION_ID_HEADER]: correlationId } : {};
}

export function createRequestLoggingMiddleware(options: {
  logger: Logger;
  observabilityMode: string | undefined;
}): (request: HttpRequestLike, response: HttpResponseLike, next: () => void) => void {
  return (request, response, next) => {
    if (!isStructuredLoggingEnabled(options.observabilityMode)) {
      next();
      return;
    }

    const correlationId =
      normalizeCorrelationId(request.headers?.[CORRELATION_ID_HEADER]) ??
      createCorrelationId();
    const startedAt = process.hrtime.bigint();

    response.setHeader?.(CORRELATION_ID_HEADER, correlationId);

    runWithCorrelationId(correlationId, () => {
      response.on?.("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const route = normalizeHttpRoute(request);
        const context = {
          method: request.method,
          route,
          path: request.originalUrl ?? request.url,
          status_code: response.statusCode,
          duration_ms: Number(durationMs.toFixed(2))
        };

        options.logger.info("http.request", context);

        if (response.statusCode >= 500) {
          options.logger.error("http.error", context);
        }
      });

      next();
    });
  };
}

function defaultSink(entry: LogEntry): void {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

type HttpRequestLike = {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type HttpResponseLike = {
  statusCode: number;
  setHeader?(name: string, value: string): void;
  on?(event: "finish", handler: () => void): void;
};

function normalizeHttpRoute(request: HttpRequestLike): string {
  const path = (request.originalUrl ?? request.url ?? "/").split("?")[0] ?? "/";

  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/txn_[A-Za-z0-9_-]+/g, ":transactionId")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

function contextCorrelationId(
  context: Record<string, unknown> | undefined
): string | undefined {
  if (!context) {
    return undefined;
  }

  return (
    normalizeCorrelationId(context.correlation_id) ??
    normalizeCorrelationId(context.correlationId)
  );
}

function contextTraceId(
  context: Record<string, unknown> | undefined
): string | undefined {
  if (!context) {
    return undefined;
  }

  return typeof context.trace_id === "string" && context.trace_id.trim()
    ? context.trace_id
    : undefined;
}

function stripCorrelationContext(
  context: Record<string, unknown>
): Record<string, unknown> {
  const rest = { ...context };
  delete rest.correlation_id;
  delete rest.correlationId;
  delete rest.trace_id;
  return rest;
}

function createLokiPusher(
  lokiPushUrl: string | undefined
): ((entry: LogEntry) => void) | undefined {
  if (!lokiPushUrl) {
    return undefined;
  }

  return (entry) => {
    const labels: Record<string, string> = {
      service: entry.service,
      level: entry.level
    };
    const route = entry.context?.route;

    if (typeof route === "string" && route.length > 0) {
      labels.route = route;
    }

    const body = JSON.stringify({
      streams: [
        {
          stream: labels,
          values: [[`${Date.now()}000000`, JSON.stringify(entry)]]
        }
      ]
    });

    void fetch(lokiPushUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body
    }).catch(() => {});
  };
}

function createOtlpLogsPusher(options: {
  endpoint: string | undefined;
  serviceName: ServiceName;
  serviceVersion: string;
  deploymentEnvironment: string;
}): ((entry: LogEntry) => void) | undefined {
  if (!options.endpoint) {
    return undefined;
  }

  const endpoint = options.endpoint;

  return (entry) => {
    const attributes = logAttributes(entry);
    const route = entry.context?.route;

    if (typeof route === "string" && route.length > 0) {
      attributes.push(otlpAttribute("route", route));
    }

    const body = JSON.stringify({
      resourceLogs: [
        {
          resource: {
            attributes: [
              otlpAttribute("service.name", options.serviceName),
              otlpAttribute("service.version", options.serviceVersion),
              otlpAttribute("deployment.environment", options.deploymentEnvironment)
            ]
          },
          scopeLogs: [
            {
              scope: {
                name: "@traceforge/logger",
                version: options.serviceVersion
              },
              logRecords: [
                {
                  timeUnixNano: unixNano(entry.timestamp),
                  severityNumber: severityNumber(entry.level),
                  severityText: entry.level.toUpperCase(),
                  body: {
                    stringValue: JSON.stringify(entry)
                  },
                  ...(entry.trace_id ? { traceId: entry.trace_id } : {}),
                  attributes
                }
              ]
            }
          ]
        }
      ]
    });

    void fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body
    }).catch(() => {});
  };
}

function logAttributes(entry: LogEntry): OtlpAttribute[] {
  const attributes = [
    otlpAttribute("service", entry.service),
    otlpAttribute("level", entry.level),
    otlpAttribute("message", entry.message)
  ];

  if (entry.correlation_id) {
    attributes.push(otlpAttribute("correlation_id", entry.correlation_id));
  }

  if (entry.trace_id) {
    attributes.push(otlpAttribute("trace_id", entry.trace_id));
  }

  for (const [key, value] of Object.entries(entry.context ?? {})) {
    attributes.push(otlpAttribute(key, value));
  }

  return attributes;
}

function otlpAttribute(key: string, value: unknown): OtlpAttribute {
  return {
    key,
    value: otlpValue(value)
  };
}

function otlpValue(value: unknown): OtlpValue {
  if (typeof value === "boolean") {
    return {
      boolValue: value
    };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? { intValue: `${value}` } : { doubleValue: value };
  }

  if (typeof value === "string") {
    return {
      stringValue: value
    };
  }

  return {
    stringValue: JSON.stringify(value)
  };
}

function unixNano(timestamp: string): string {
  return `${BigInt(Date.parse(timestamp)) * 1_000_000n}`;
}

function severityNumber(level: LogLevel): number {
  switch (level) {
    case "debug":
      return 5;
    case "warn":
      return 13;
    case "error":
      return 17;
    default:
      return 9;
  }
}

type OtlpAttribute = {
  key: string;
  value: OtlpValue;
};

type OtlpValue =
  | {
      stringValue: string;
    }
  | {
      intValue: string;
    }
  | {
      doubleValue: number;
    }
  | {
      boolValue: boolean;
    };
