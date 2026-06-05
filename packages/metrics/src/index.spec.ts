import { describe, expect, it } from "vitest";
import {
  createInMemoryMetricsRegistry,
  createPrometheusMetricsRegistry,
  createNoopMetricsRegistry
} from "./index";

describe("metrics", () => {
  it("records counters and HTTP request timings in memory", () => {
    const metrics = createInMemoryMetricsRegistry();

    metrics.incrementCounter("requests_total");
    metrics.incrementCounter("requests_total", 2);
    metrics.recordHttpRequest({
      method: "GET",
      route: "/health",
      statusCode: 200,
      durationMs: 3
    });

    expect(metrics.snapshot()).toEqual({
      counters: { requests_total: 3 },
      httpRequests: [
        {
          method: "GET",
          route: "/health",
          statusCode: 200,
          durationMs: 3
        }
      ]
    });
  });

  it("keeps the noop registry empty", () => {
    const metrics = createNoopMetricsRegistry();

    metrics.incrementCounter("ignored");
    metrics.recordDbQuery("ignored", 1);

    expect(metrics.snapshot()).toEqual({
      counters: {},
      httpRequests: []
    });
  });

  it("exports Prometheus application metrics", async () => {
    const metrics = createPrometheusMetricsRegistry({
      serviceName: "api-gateway",
      observabilityMode: "metrics"
    });

    metrics.recordHttpRequest({
      method: "GET",
      route: "/health",
      statusCode: 200,
      durationMs: 4
    });
    metrics.recordHttpRequest({
      method: "GET",
      route: "/missing",
      statusCode: 404,
      durationMs: 6
    });
    metrics.recordDbQuery("find_transaction_by_id", 3);
    metrics.recordRedisOperation("get_transaction", 2);
    metrics.recordRabbitMqPublish("transaction.events", 1);
    metrics.recordRabbitMqConsume("transaction.events", 5);

    const output = await metrics.metrics();

    expect(output).toContain("http_requests_total");
    expect(output).toContain("http_request_duration_seconds");
    expect(output).toContain("http_errors_total");
    expect(output).toContain("db_query_duration_seconds");
    expect(output).toContain("redis_operation_duration_seconds");
    expect(output).toContain("rabbitmq_publish_duration_seconds");
    expect(output).toContain("rabbitmq_consume_duration_seconds");
    expect(output).toContain('service="api-gateway"');
  });
});
