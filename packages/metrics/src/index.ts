import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export type ObservabilityMode =
  | "none"
  | "metrics"
  | "metrics_logs"
  | "metrics_logs_traces"
  | "otel_full";

export interface HttpRequestMetric {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  httpRequests: HttpRequestMetric[];
}

export interface MetricsRegistry {
  enabled: boolean;
  contentType: string;
  incrementCounter(name: string, value?: number): void;
  recordHttpRequest(metric: HttpRequestMetric): void;
  recordDbQuery(operation: string, durationMs: number): void;
  recordRedisOperation(operation: string, durationMs: number): void;
  recordRabbitMqPublish(queue: string, durationMs: number): void;
  recordRabbitMqConsume(queue: string, durationMs: number): void;
  metrics(): Promise<string>;
  snapshot(): MetricsSnapshot;
}

export interface ServiceMetricsOptions {
  serviceName: string;
  observabilityMode: ObservabilityMode;
}

export interface HttpLikeRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
}

export interface HttpLikeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
  once(event: "finish", listener: () => void): void;
}

export type HttpLikeNext = () => void;

type HttpMetricLabels = "method" | "route" | "status_code";
type OperationMetricLabels = "operation";
type QueueMetricLabels = "queue";

const durationBucketsSeconds = [
  0.001, 0.003, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5
];

export function isMetricsEnabled(mode: ObservabilityMode): boolean {
  return mode !== "none";
}

export function createPrometheusMetricsRegistry(
  options: ServiceMetricsOptions
): MetricsRegistry {
  if (!isMetricsEnabled(options.observabilityMode)) {
    return createNoopMetricsRegistry();
  }

  const register = new Registry();
  register.setDefaultLabels({
    service: options.serviceName
  });

  collectDefaultMetrics({
    register
  });

  const httpRequests = new Counter<HttpMetricLabels>({
    name: "http_requests_total",
    help: "Total HTTP requests handled by the service.",
    labelNames: ["method", "route", "status_code"],
    registers: [register]
  });
  const httpRequestDuration = new Histogram<HttpMetricLabels>({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds.",
    labelNames: ["method", "route", "status_code"],
    buckets: durationBucketsSeconds,
    registers: [register]
  });
  const httpErrors = new Counter<HttpMetricLabels>({
    name: "http_errors_total",
    help: "Total HTTP requests that completed with a 4xx or 5xx status.",
    labelNames: ["method", "route", "status_code"],
    registers: [register]
  });
  const dbQueryDuration = new Histogram<OperationMetricLabels>({
    name: "db_query_duration_seconds",
    help: "Database query duration in seconds.",
    labelNames: ["operation"],
    buckets: durationBucketsSeconds,
    registers: [register]
  });
  const redisOperationDuration = new Histogram<OperationMetricLabels>({
    name: "redis_operation_duration_seconds",
    help: "Redis operation duration in seconds.",
    labelNames: ["operation"],
    buckets: durationBucketsSeconds,
    registers: [register]
  });
  const rabbitMqPublishDuration = new Histogram<QueueMetricLabels>({
    name: "rabbitmq_publish_duration_seconds",
    help: "RabbitMQ publish duration in seconds.",
    labelNames: ["queue"],
    buckets: durationBucketsSeconds,
    registers: [register]
  });
  const rabbitMqConsumeDuration = new Histogram<QueueMetricLabels>({
    name: "rabbitmq_consume_duration_seconds",
    help: "RabbitMQ consume handler duration in seconds.",
    labelNames: ["queue"],
    buckets: durationBucketsSeconds,
    registers: [register]
  });

  return {
    enabled: true,
    contentType: register.contentType,
    incrementCounter() {
      return undefined;
    },
    recordHttpRequest(metric) {
      const labels = {
        method: metric.method,
        route: metric.route,
        status_code: String(metric.statusCode)
      };

      httpRequests.inc(labels);
      httpRequestDuration.observe(labels, metric.durationMs / 1000);

      if (metric.statusCode >= 400) {
        httpErrors.inc(labels);
      }
    },
    recordDbQuery(operation, durationMs) {
      dbQueryDuration.observe({ operation }, durationMs / 1000);
    },
    recordRedisOperation(operation, durationMs) {
      redisOperationDuration.observe({ operation }, durationMs / 1000);
    },
    recordRabbitMqPublish(queue, durationMs) {
      rabbitMqPublishDuration.observe({ queue }, durationMs / 1000);
    },
    recordRabbitMqConsume(queue, durationMs) {
      rabbitMqConsumeDuration.observe({ queue }, durationMs / 1000);
    },
    metrics() {
      return register.metrics();
    },
    snapshot() {
      return {
        counters: {},
        httpRequests: []
      };
    }
  };
}

export function createMetricsHttpMiddleware(metrics: MetricsRegistry) {
  return (
    request: HttpLikeRequest,
    response: HttpLikeResponse,
    next: HttpLikeNext
  ): void => {
    if (isMetricsRequest(request)) {
      if (!metrics.enabled) {
        next();
        return;
      }

      void respondWithMetrics(metrics, response);
      return;
    }

    if (!metrics.enabled) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();

    response.once("finish", () => {
      metrics.recordHttpRequest({
        method: request.method ?? "UNKNOWN",
        route: normalizeRoute(request.originalUrl ?? request.url ?? "/"),
        statusCode: response.statusCode,
        durationMs: elapsedMs(startedAt)
      });
    });

    next();
  };
}

export function createInMemoryMetricsRegistry(): MetricsRegistry {
  const counters = new Map<string, number>();
  const httpRequests: HttpRequestMetric[] = [];

  return {
    enabled: true,
    contentType: "text/plain",
    incrementCounter(name, value = 1) {
      counters.set(name, (counters.get(name) ?? 0) + value);
    },
    recordHttpRequest(metric) {
      httpRequests.push({ ...metric });
    },
    recordDbQuery() {
      return undefined;
    },
    recordRedisOperation() {
      return undefined;
    },
    recordRabbitMqPublish() {
      return undefined;
    },
    recordRabbitMqConsume() {
      return undefined;
    },
    async metrics() {
      return "";
    },
    snapshot() {
      return {
        counters: Object.fromEntries(counters.entries()),
        httpRequests: [...httpRequests]
      };
    }
  };
}

export function createNoopMetricsRegistry(): MetricsRegistry {
  return {
    enabled: false,
    contentType: "text/plain",
    incrementCounter() {
      return undefined;
    },
    recordHttpRequest() {
      return undefined;
    },
    recordDbQuery() {
      return undefined;
    },
    recordRedisOperation() {
      return undefined;
    },
    recordRabbitMqPublish() {
      return undefined;
    },
    recordRabbitMqConsume() {
      return undefined;
    },
    async metrics() {
      return "";
    },
    snapshot() {
      return {
        counters: {},
        httpRequests: []
      };
    }
  };
}

export async function timeAsync<T>(
  recordDuration: (durationMs: number) => void,
  work: () => Promise<T>
): Promise<T> {
  const startedAt = process.hrtime.bigint();

  try {
    return await work();
  } finally {
    recordDuration(elapsedMs(startedAt));
  }
}

function isMetricsRequest(request: HttpLikeRequest): boolean {
  return (
    request.method === "GET" &&
    normalizePath(request.originalUrl ?? request.url ?? "/") === "/metrics"
  );
}

async function respondWithMetrics(
  metrics: MetricsRegistry,
  response: HttpLikeResponse
): Promise<void> {
  response.setHeader("Content-Type", metrics.contentType);
  response.end(await metrics.metrics());
}

function normalizeRoute(value: string): string {
  const path = normalizePath(value);

  if (/^\/transactions\/[^/]+$/.test(path)) {
    return "/transactions/:id";
  }

  if (/^\/users\/[^/]+\/transactions$/.test(path)) {
    return "/users/:userId/transactions";
  }

  return path;
}

function normalizePath(value: string): string {
  const path = value.split("?")[0] || "/";
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}
