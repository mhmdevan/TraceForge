import { ServiceName } from "@traceforge/contracts";
import {
  context as otelContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace as otelTrace,
  type Span,
  type SpanAttributes
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  TraceIdRatioBasedSampler
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export interface SpanRecord {
  name: string;
  startedAt: string;
  endedAt: string;
  attributes: Record<string, string | number | boolean>;
}

export type SpanKindName = "internal" | "server" | "client" | "producer" | "consumer";

export interface SpanOptions {
  kind?: SpanKindName;
  attributes?: Record<string, string | number | boolean | undefined>;
}

export interface Tracer {
  withSpan<T>(
    name: string,
    callback: () => T | Promise<T>,
    attributes?: Record<string, string | number | boolean>
  ): Promise<T>;
}

export interface TraceHeaders {
  [key: string]: string;
}

export interface ServiceTracer extends Tracer {
  enabled: boolean;
  getCurrentTraceId(): string | undefined;
  getTraceHeaders(): TraceHeaders;
  runWithExtractedTrace<T>(
    headers: Record<string, unknown> | undefined,
    work: () => T
  ): T;
  withSpan<T>(
    name: string,
    callback: () => T | Promise<T>,
    options?: SpanOptions
  ): Promise<T>;
}

export interface OpenTelemetryRuntime {
  enabled: boolean;
  shutdown(): Promise<void>;
}

export interface OpenTelemetryRuntimeOptions {
  serviceName: ServiceName;
  serviceVersion?: string;
  deploymentEnvironment?: string;
  observabilityMode?: string;
  otlpTraceEndpoint?: string;
  samplingRatio?: number;
}

export interface ServiceTracerOptions {
  serviceName: ServiceName;
  observabilityMode?: string;
}

export function isTracingEnabled(mode: string | undefined): boolean {
  return mode === "metrics_logs_traces" || mode === "otel_full";
}

export function startOpenTelemetryTracing(
  options: OpenTelemetryRuntimeOptions
): OpenTelemetryRuntime {
  if (!isTracingEnabled(options.observabilityMode)) {
    return {
      enabled: false,
      async shutdown() {}
    };
  }

  const exporter = new OTLPTraceExporter({
    url: options.otlpTraceEndpoint ?? "http://localhost:4318/v1/traces"
  });
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": options.serviceName,
      "service.version": options.serviceVersion ?? "0.1.0",
      "deployment.environment": options.deploymentEnvironment ?? "development"
    }),
    sampler: new TraceIdRatioBasedSampler(options.samplingRatio ?? 1),
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        scheduledDelayMillis: 250,
        maxExportBatchSize: 64,
        exportTimeoutMillis: 2000,
        maxQueueSize: 4096
      })
    ]
  });

  provider.register();

  return {
    enabled: true,
    async shutdown() {
      await provider.forceFlush();
      await provider.shutdown();
    }
  };
}

export function createOpenTelemetryTracer(options: ServiceTracerOptions): ServiceTracer {
  if (!isTracingEnabled(options.observabilityMode)) {
    return createNoopServiceTracer();
  }

  const tracer = otelTrace.getTracer(options.serviceName);

  return {
    enabled: true,
    async withSpan(name, callback, spanOptions = {}) {
      return tracer.startActiveSpan(
        name,
        {
          kind: toOpenTelemetrySpanKind(spanOptions.kind),
          attributes: cleanAttributes(spanOptions.attributes)
        },
        async (span) => finishSpan(span, callback)
      );
    },
    getCurrentTraceId() {
      return otelTrace.getActiveSpan()?.spanContext().traceId;
    },
    getTraceHeaders() {
      const headers: TraceHeaders = {};
      propagation.inject(otelContext.active(), headers, headerSetter);
      return headers;
    },
    runWithExtractedTrace(headers, work) {
      const extractedContext = propagation.extract(
        otelContext.active(),
        headers ?? {},
        headerGetter
      );
      return otelContext.with(extractedContext, work);
    }
  };
}

export function createTraceHttpMiddleware(
  tracer: ServiceTracer
): (request: HttpRequestLike, response: HttpResponseLike, next: () => void) => void {
  return (request, response, next) => {
    if (!tracer.enabled) {
      next();
      return;
    }

    tracer.runWithExtractedTrace(request.headers, () => {
      const otelTracer = otelTrace.getTracer("http-server");
      const route = normalizeHttpRoute(request);
      const span = otelTracer.startSpan(`HTTP ${request.method ?? "GET"} ${route}`, {
        kind: SpanKind.SERVER,
        attributes: cleanAttributes({
          "http.request.method": request.method,
          "http.route": route,
          "url.path": request.originalUrl ?? request.url
        })
      });
      const spanContext = otelTrace.setSpan(otelContext.active(), span);

      otelContext.with(spanContext, () => {
        response.on?.("finish", () => {
          span.setAttributes(
            cleanAttributes({
              "http.response.status_code": response.statusCode
            })
          );

          if (response.statusCode >= 500) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `HTTP ${response.statusCode}`
            });
          }

          span.end();
        });

        next();
      });
    });
  };
}

export function createNoopTracer(): Tracer {
  return {
    async withSpan(_name, callback) {
      return callback();
    }
  };
}

export function createNoopServiceTracer(): ServiceTracer {
  return {
    enabled: false,
    async withSpan(_name, callback) {
      return callback();
    },
    getCurrentTraceId() {
      return undefined;
    },
    getTraceHeaders() {
      return {};
    },
    runWithExtractedTrace(_headers, work) {
      return work();
    }
  };
}

export function createInMemoryTracer(spans: SpanRecord[] = []): Tracer {
  return {
    async withSpan(name, callback, attributes = {}) {
      const startedAt = new Date().toISOString();

      try {
        return await callback();
      } finally {
        spans.push({
          name,
          startedAt,
          endedAt: new Date().toISOString(),
          attributes
        });
      }
    }
  };
}

async function finishSpan<T>(span: Span, callback: () => T | Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : "unknown"
    });
    throw error;
  } finally {
    span.end();
  }
}

function toOpenTelemetrySpanKind(kind: SpanKindName | undefined): SpanKind {
  switch (kind) {
    case "server":
      return SpanKind.SERVER;
    case "client":
      return SpanKind.CLIENT;
    case "producer":
      return SpanKind.PRODUCER;
    case "consumer":
      return SpanKind.CONSUMER;
    default:
      return SpanKind.INTERNAL;
  }
}

function cleanAttributes(
  attributes: Record<string, string | number | boolean | undefined> | undefined
): SpanAttributes {
  if (!attributes) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(attributes).filter(
      (entry): entry is [string, string | number | boolean] => entry[1] !== undefined
    )
  );
}

const headerSetter = {
  set(headers: TraceHeaders, key: string, value: string) {
    headers[key] = value;
  }
};

const headerGetter = {
  keys(headers: Record<string, unknown>): string[] {
    return Object.keys(headers);
  },
  get(headers: Record<string, unknown>, key: string): string | string[] | undefined {
    const exactValue = headers[key];
    const lowerValue = headers[key.toLowerCase()];
    const value = exactValue ?? lowerValue;

    if (typeof value === "string") {
      return value;
    }

    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      return value;
    }

    return undefined;
  }
};

type HttpRequestLike = {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type HttpResponseLike = {
  statusCode: number;
  on?(event: "finish", handler: () => void): void;
};

function normalizeHttpRoute(request: HttpRequestLike): string {
  const path = (request.originalUrl ?? request.url ?? "/").split("?")[0] ?? "/";

  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/txn_[A-Za-z0-9_-]+/g, ":transactionId")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}
