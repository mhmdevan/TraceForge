import { randomUUID } from "node:crypto";

const services = [
  {
    name: "api-gateway",
    url: process.env.API_GATEWAY_URL ?? "http://localhost:3000"
  },
  {
    name: "transaction-service",
    url: process.env.TRANSACTION_SERVICE_URL ?? "http://localhost:3001"
  },
  {
    name: "payment-service",
    url: process.env.PAYMENT_SERVICE_URL ?? "http://localhost:3002"
  },
  {
    name: "worker-service",
    url: process.env.WORKER_SERVICE_URL ?? "http://localhost:3003"
  }
];

const prometheusUrl = process.env.PROMETHEUS_URL ?? "http://localhost:9090";
const grafanaUrl = process.env.GRAFANA_URL ?? "http://localhost:3004";
const lokiUrl = process.env.LOKI_URL ?? "http://localhost:3100";
const jaegerUrl = process.env.JAEGER_URL ?? "http://localhost:16686";
const collectorHealthUrl =
  process.env.OTEL_COLLECTOR_HEALTH_URL ?? "http://localhost:13133";
const collectorMetricsUrl =
  process.env.OTEL_COLLECTOR_PROMETHEUS_URL ?? "http://localhost:8889";

async function main(): Promise<void> {
  await checkServiceMetrics();
  await expectOk(`${collectorHealthUrl}/`, "otel collector health");
  await waitForCollectorMetrics();
  await waitForPrometheusTargets();
  await checkAlertRules();
  await expectOk(`${grafanaUrl}/api/health`, "grafana health");
  await expectOk(`${lokiUrl}/ready`, "loki readiness");
  await expectOk(`${jaegerUrl}/api/services`, "jaeger services api");
  await checkTraceLogCorrelation();

  console.log("full otel smoke check passed");
}

async function checkTraceLogCorrelation(): Promise<void> {
  const correlationId = `phase7-${randomUUID()}`;

  const createResponse = await fetch(`${services[0].url}/transactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": correlationId
    },
    body: JSON.stringify({
      userId: "otel-full-smoke-user",
      amount: 12.5,
      currency: "USD",
      description: "slow-payment"
    })
  });

  if (createResponse.status !== 201) {
    throw new Error(`otel smoke create returned ${createResponse.status}`);
  }

  await retry(async () => {
    const logs = await queryLokiByCorrelationId(correlationId);
    const servicesWithLogs = new Set(logs.map((log) => log.service));

    for (const serviceName of services.map((service) => service.name)) {
      if (!servicesWithLogs.has(serviceName)) {
        throw new Error(
          `loki has not received ${correlationId} OTLP logs from ${serviceName} yet`
        );
      }
    }

    const traceId = logs.find((log) => log.trace_id)?.trace_id;

    if (!traceId) {
      throw new Error(`OTLP logs for ${correlationId} do not include trace_id yet`);
    }

    const trace = await fetchJaegerTrace(traceId);
    const serviceNames = new Set(
      trace.spans
        .map((span) => trace.processes?.[span.processID]?.serviceName)
        .filter((serviceName): serviceName is string => Boolean(serviceName))
    );

    for (const serviceName of services.map((service) => service.name)) {
      if (!serviceNames.has(serviceName)) {
        throw new Error(`trace ${traceId} is missing ${serviceName}`);
      }
    }

    if (trace.spans.length < 5) {
      throw new Error(`trace ${traceId} has only ${trace.spans.length} spans`);
    }

    const operationNames = trace.spans.map((span) => span.operationName);
    assertHasOperation(operationNames, (name) => name.startsWith("HTTP "), "HTTP");
    assertHasOperation(
      operationNames,
      (name) => name.startsWith("postgres."),
      "PostgreSQL"
    );
    assertHasOperation(operationNames, (name) => name.startsWith("redis."), "Redis");
    assertHasOperation(
      operationNames,
      (name) => name.startsWith("rabbitmq."),
      "RabbitMQ"
    );

    const slowPaymentSpan = trace.spans.find(
      (span) =>
        span.operationName === "payment.authorize" &&
        (span.duration >= 100_000 ||
          span.tags?.some(
            (tag) =>
              tag.key === "traceforge.simulated_payment_delay_ms" &&
              Number(tag.value) >= 100
          ))
    );

    if (!slowPaymentSpan) {
      throw new Error(`trace ${traceId} does not show the slow payment span`);
    }
  });
}

async function waitForCollectorMetrics(): Promise<void> {
  await retry(async () => {
    const response = await fetch(`${collectorMetricsUrl}/metrics`);
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`otel collector prometheus exporter returned ${response.status}`);
    }

    if (!body.includes("http_requests_total")) {
      throw new Error("otel collector prometheus exporter has no service metrics yet");
    }
  });
}

async function waitForPrometheusTargets(): Promise<void> {
  const requiredJobs = new Set([
    ...services.map((service) => service.name),
    "otel-collector",
    "otel-collector-self"
  ]);

  await retry(async () => {
    await expectOk(`${prometheusUrl}/-/healthy`, "prometheus health");

    const response = await fetch(`${prometheusUrl}/api/v1/targets`);
    const payload = (await response.json()) as {
      data?: {
        activeTargets?: Array<{
          health?: string;
          labels?: {
            job?: string;
          };
        }>;
      };
    };

    const healthyJobs = new Set(
      (payload.data?.activeTargets ?? [])
        .filter((target) => target.health === "up")
        .map((target) => target.labels?.job)
        .filter((job): job is string => Boolean(job))
    );

    for (const job of requiredJobs) {
      if (!healthyJobs.has(job)) {
        throw new Error(`prometheus target ${job} is not up yet`);
      }
    }
  });
}

async function checkAlertRules(): Promise<void> {
  const response = await fetch(`${prometheusUrl}/api/v1/rules`);

  if (!response.ok) {
    throw new Error(`prometheus rules returned ${response.status}`);
  }

  const payload = (await response.json()) as PrometheusRulesResponse;
  const alertNames = new Set(
    (payload.data?.groups ?? []).flatMap((group) =>
      (group.rules ?? [])
        .filter((rule) => rule.type === "alerting")
        .map((rule) => rule.name)
    )
  );

  for (const alertName of [
    "TraceForgeHighP95Latency",
    "TraceForgeHttpErrors",
    "TraceForgeOtelCollectorDown"
  ]) {
    if (!alertNames.has(alertName)) {
      throw new Error(`prometheus alert ${alertName} is missing`);
    }
  }
}

async function queryLokiByCorrelationId(correlationId: string): Promise<LokiLogEntry[]> {
  const queryUrl = new URL(`${lokiUrl}/loki/api/v1/query`);
  queryUrl.searchParams.set("query", `{service=~".+"} |= "${correlationId}"`);

  const response = await fetch(queryUrl);

  if (!response.ok) {
    throw new Error(`loki query returned ${response.status}`);
  }

  const payload = (await response.json()) as LokiQueryResponse;

  return (payload.data?.result ?? [])
    .flatMap((stream) => stream.values ?? [])
    .map((value) => value[1])
    .map(parseLokiLogLine);
}

function parseLokiLogLine(line: string): LokiLogEntry {
  const value = JSON.parse(line) as LokiLogEntry | { body?: string };

  if (typeof value.body === "string") {
    return JSON.parse(value.body) as LokiLogEntry;
  }

  return value as LokiLogEntry;
}

async function fetchJaegerTrace(traceId: string): Promise<JaegerTrace> {
  const response = await fetch(`${jaegerUrl}/api/traces/${traceId}`);

  if (!response.ok) {
    throw new Error(`jaeger trace lookup returned ${response.status}`);
  }

  const payload = (await response.json()) as JaegerTraceResponse;
  const trace = payload.data?.[0];

  if (!trace) {
    throw new Error(`jaeger trace ${traceId} not found yet`);
  }

  return trace;
}

function assertHasOperation(
  operationNames: string[],
  predicate: (name: string) => boolean,
  label: string
): void {
  if (!operationNames.some(predicate)) {
    throw new Error(`trace is missing ${label} spans`);
  }
}

async function checkServiceMetrics(): Promise<void> {
  for (const service of services) {
    await expectOk(`${service.url}/health`, `${service.name} health`);

    const response = await fetch(`${service.url}/metrics`);
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`${service.name} metrics returned ${response.status}`);
    }

    for (const metricName of requiredMetricNames(service.name)) {
      if (!body.includes(metricName)) {
        throw new Error(`${service.name} metrics missing ${metricName}`);
      }
    }
  }
}

function requiredMetricNames(serviceName: string): string[] {
  const names = [
    "http_requests_total",
    "http_request_duration_seconds",
    "http_errors_total",
    "process_cpu_seconds_total",
    "process_resident_memory_bytes"
  ];

  if (serviceName === "transaction-service") {
    names.push(
      "db_query_duration_seconds",
      "redis_operation_duration_seconds",
      "rabbitmq_publish_duration_seconds"
    );
  }

  if (serviceName === "worker-service") {
    names.push("db_query_duration_seconds", "rabbitmq_consume_duration_seconds");
  }

  return names;
}

async function expectOk(url: string, label: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${label} returned ${response.status}`);
  }
}

async function retry(work: () => Promise<void>): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      await work();
      return;
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("retry failed");
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, durationMs);
  });
}

type LokiQueryResponse = {
  data?: {
    result?: Array<{
      values?: Array<[string, string]>;
    }>;
  };
};

type LokiLogEntry = {
  body?: string;
  service: string;
  correlation_id?: string;
  trace_id?: string;
};

type JaegerTraceResponse = {
  data?: JaegerTrace[];
};

type JaegerTrace = {
  traceID: string;
  spans: JaegerSpan[];
  processes?: Record<
    string,
    {
      serviceName?: string;
    }
  >;
};

type JaegerSpan = {
  operationName: string;
  duration: number;
  processID: string;
  tags?: Array<{
    key: string;
    value?: unknown;
  }>;
};

type PrometheusRulesResponse = {
  data?: {
    groups?: Array<{
      rules?: Array<{
        name: string;
        type?: string;
      }>;
    }>;
  };
};

void main();
