import {
  PaymentAuthorizationRequest,
  PaymentAuthorizationResponse
} from "@traceforge/contracts";
import { getCorrelationHeaders, Logger, createNoopLogger } from "@traceforge/logger";
import { ServiceTracer, createNoopServiceTracer } from "@traceforge/tracing";
import { PaymentClient } from "./transaction-ports";

export type FetchLike = typeof fetch;

export class PaymentHttpClient implements PaymentClient {
  constructor(
    private readonly paymentServiceUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly logger: Logger = createNoopLogger(),
    private readonly tracer: ServiceTracer = createNoopServiceTracer(),
    private readonly timeoutMs = 5000
  ) {}

  async authorize(
    request: PaymentAuthorizationRequest,
    options: { simulatedDelayMs?: number } = {}
  ): Promise<PaymentAuthorizationResponse> {
    return this.tracer.withSpan(
      "HTTP POST payment-service/payments/authorize",
      async () => {
        const startedAt = process.hrtime.bigint();
        const response = await this.fetchImpl(
          `${this.paymentServiceUrl}/payments/authorize`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...getCorrelationHeaders(),
              ...this.tracer.getTraceHeaders(),
              ...(options.simulatedDelayMs
                ? { "x-simulated-payment-delay-ms": `${options.simulatedDelayMs}` }
                : {})
            },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(this.timeoutMs)
          }
        );
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

        if (!response.ok) {
          this.logger.error("http.downstream.error", {
            target_service: "payment-service",
            method: "POST",
            route: "/payments/authorize",
            status_code: response.status,
            duration_ms: Number(durationMs.toFixed(2))
          });
          throw new Error(`payment-service returned ${response.status}`);
        }

        this.logger.info("http.downstream.request", {
          target_service: "payment-service",
          method: "POST",
          route: "/payments/authorize",
          status_code: response.status,
          duration_ms: Number(durationMs.toFixed(2))
        });

        return (await response.json()) as PaymentAuthorizationResponse;
      },
      {
        kind: "client",
        attributes: {
          "http.request.method": "POST",
          "server.address": "payment-service",
          "http.route": "/payments/authorize",
          "traceforge.simulated_payment_delay_ms": options.simulatedDelayMs
        }
      }
    );
  }
}
