import { describe, expect, it } from "vitest";
import {
  createLogger,
  getCorrelationHeaders,
  LogEntry,
  runWithCorrelationId
} from "./index";

describe("logger", () => {
  it("writes structured service logs", () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      serviceName: "transaction-service",
      sink: (entry) => entries.push(entry)
    });

    logger.info("transaction.received", { transactionId: "txn_1" });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "info",
      service: "transaction-service",
      message: "transaction.received",
      context: { transactionId: "txn_1" }
    });
  });

  it("adds the active correlation id to structured logs and headers", () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      serviceName: "api-gateway",
      sink: (entry) => entries.push(entry)
    });

    runWithCorrelationId("corr_123", () => {
      logger.info("http.request", { route: "/transactions" });

      expect(getCorrelationHeaders()).toEqual({
        "x-correlation-id": "corr_123"
      });
    });

    expect(entries[0]).toMatchObject({
      correlation_id: "corr_123",
      context: { route: "/transactions" }
    });
  });

  it("adds trace ids to structured logs without duplicating them in context", () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      serviceName: "payment-service",
      traceIdProvider: () => "trace_123",
      sink: (entry) => entries.push(entry)
    });

    logger.info("payment.authorized", {
      trace_id: "trace_context",
      transaction_id: "txn_1"
    });

    expect(entries[0]).toMatchObject({
      trace_id: "trace_context",
      context: {
        transaction_id: "txn_1"
      }
    });
  });
});
