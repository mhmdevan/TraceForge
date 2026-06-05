export const SERVICE_NAMES = [
  "api-gateway",
  "transaction-service",
  "payment-service",
  "worker-service"
] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

export const OBSERVABILITY_MODES = [
  "none",
  "metrics",
  "metrics_logs",
  "metrics_logs_traces",
  "otel_full"
] as const;

export type ObservabilityMode = (typeof OBSERVABILITY_MODES)[number];

export type HealthStatus = "ok" | "degraded";

export interface HealthResponse {
  service: ServiceName;
  status: HealthStatus;
  uptimeSeconds: number;
  timestamp: string;
  version: string;
  observabilityMode: ObservabilityMode;
}

export const TRANSACTION_STATUSES = [
  "pending",
  "approved",
  "declined",
  "failed"
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const PAYMENT_STATUSES = ["approved", "declined"] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface CreateTransactionRequest {
  userId: string;
  amount: number;
  currency: string;
  description?: string;
}

export interface TransactionResponse {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  description?: string;
  status: TransactionStatus;
  paymentStatus: PaymentStatus | "pending" | "failed";
  paymentReference?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransactionResponse {
  transaction: TransactionResponse;
}

export interface TransactionHistoryResponse {
  transactions: TransactionResponse[];
}

export interface PaymentAuthorizationRequest {
  transactionId: string;
  userId: string;
  amount: number;
  currency: string;
}

export interface PaymentAuthorizationResponse {
  transactionId: string;
  status: PaymentStatus;
  providerReference: string;
  authorizedAt: string;
}

export type TransactionEventType = "transaction.created";

export interface TransactionCreatedEvent {
  id: string;
  type: TransactionEventType;
  transactionId: string;
  userId: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  occurredAt: string;
}

export function assertCreateTransactionRequest(value: unknown): CreateTransactionRequest {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const userId = value.userId;
  const amount = value.amount;
  const currency = value.currency;
  const description = value.description;

  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("userId is required.");
  }

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive number.");
  }

  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("currency must be a 3-letter uppercase ISO code.");
  }

  if (description !== undefined && typeof description !== "string") {
    throw new Error("description must be a string when provided.");
  }

  return {
    userId: userId.trim(),
    amount,
    currency,
    description: description?.trim() || undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
