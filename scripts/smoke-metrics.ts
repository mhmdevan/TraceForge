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

async function main(): Promise<void> {
  await checkServiceMetrics();
  await waitForPrometheusTargets();
  await expectOk(`${grafanaUrl}/api/health`, "grafana health");

  console.log("metrics smoke check passed");
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

void main();
