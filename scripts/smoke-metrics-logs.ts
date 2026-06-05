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

async function main(): Promise<void> {
  await checkServiceMetrics();
  await waitForPrometheusTargets();
  await expectOk(`${grafanaUrl}/api/health`, "grafana health");
  await expectOk(`${lokiUrl}/ready`, "loki readiness");
  await checkCorrelationIdInLoki();

  console.log("metrics+logs smoke check passed");
}

async function checkCorrelationIdInLoki(): Promise<void> {
  const correlationId = `phase5-${randomUUID()}`;

  const createResponse = await fetch(`${services[0].url}/transactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": correlationId
    },
    body: JSON.stringify({
      userId: "metrics-logs-smoke-user",
      amount: 12.5,
      currency: "USD",
      description: "Phase 5 smoke transaction"
    })
  });

  if (createResponse.status !== 201) {
    throw new Error(`correlation smoke create returned ${createResponse.status}`);
  }

  await retry(async () => {
    const logs = await queryLokiByCorrelationId(correlationId);
    const servicesWithLogs = new Set(logs.map((log) => log.service));

    for (const serviceName of services.map((service) => service.name)) {
      if (!servicesWithLogs.has(serviceName)) {
        throw new Error(
          `loki has not received ${correlationId} logs from ${serviceName} yet`
        );
      }
    }

    for (const log of logs) {
      if (log.correlation_id !== correlationId) {
        throw new Error(`log entry missing expected correlation id ${correlationId}`);
      }
    }
  });
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
    .map((line) => JSON.parse(line) as LokiLogEntry);
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

async function waitForPrometheusTargets(): Promise<void> {
  const requiredJobs = new Set(services.map((service) => service.name));

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

  for (let attempt = 1; attempt <= 30; attempt += 1) {
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
  service: string;
  correlation_id?: string;
};

void main();
