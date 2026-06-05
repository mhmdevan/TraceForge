import {
  CreateTransactionRequest,
  CreateTransactionResponse,
  TransactionHistoryResponse,
  TransactionResponse
} from "@traceforge/contracts";
import { getCorrelationHeaders, Logger, createNoopLogger } from "@traceforge/logger";
import { ServiceTracer, createNoopServiceTracer } from "@traceforge/tracing";

export type FetchLike = typeof fetch;

export class TransactionsGatewayClient {
  constructor(
    private readonly transactionServiceUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly logger: Logger = createNoopLogger(),
    private readonly tracer: ServiceTracer = createNoopServiceTracer()
  ) {}

  async createTransaction(
    request: CreateTransactionRequest
  ): Promise<CreateTransactionResponse> {
    return this.request<CreateTransactionResponse>("/transactions", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  async getTransaction(id: string): Promise<TransactionResponse> {
    return this.request<TransactionResponse>(`/transactions/${encodeURIComponent(id)}`);
  }

  async getUserTransactions(userId: string): Promise<TransactionHistoryResponse> {
    return this.request<TransactionHistoryResponse>(
      `/users/${encodeURIComponent(userId)}/transactions`
    );
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.tracer.withSpan(
      `HTTP ${init.method ?? "GET"} transaction-service${path}`,
      async () => {
        const startedAt = process.hrtime.bigint();
        const response = await this.fetchImpl(`${this.transactionServiceUrl}${path}`, {
          ...init,
          headers: {
            "content-type": "application/json",
            ...getCorrelationHeaders(),
            ...this.tracer.getTraceHeaders(),
            ...(init.headers ?? {})
          }
        });
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

        if (!response.ok) {
          const body = await safeReadBody(response);
          this.logger.error("http.downstream.error", {
            target_service: "transaction-service",
            method: init.method ?? "GET",
            route: path,
            status_code: response.status,
            duration_ms: Number(durationMs.toFixed(2))
          });
          throw new Error(
            `transaction-service returned ${response.status}: ${
              body || response.statusText
            }`
          );
        }

        this.logger.info("http.downstream.request", {
          target_service: "transaction-service",
          method: init.method ?? "GET",
          route: path,
          status_code: response.status,
          duration_ms: Number(durationMs.toFixed(2))
        });

        return (await response.json()) as T;
      },
      {
        kind: "client",
        attributes: {
          "http.request.method": init.method ?? "GET",
          "server.address": "transaction-service",
          "http.route": path
        }
      }
    );
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
