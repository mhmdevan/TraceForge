import { describe, expect, it } from "vitest";
import { PaymentFaultConfig } from "@traceforge/config";
import { PaymentsService } from "./payments.service";

const baseRequest = {
  transactionId: "txn_fault",
  userId: "user-1",
  amount: 100,
  currency: "USD"
} as const;

function faults(overrides: Partial<PaymentFaultConfig>): PaymentFaultConfig {
  return {
    mode: "normal",
    delayMs: 0,
    errorRate: 0,
    timeoutRate: 0,
    timeoutMs: 50,
    ...overrides
  };
}

describe("payments service", () => {
  it("approves ordinary payments", async () => {
    const service = new PaymentsService();

    await expect(
      service.authorize({
        transactionId: "txn_1",
        userId: "user-1",
        amount: 100,
        currency: "USD"
      })
    ).resolves.toMatchObject({
      transactionId: "txn_1",
      status: "approved",
      providerReference: "pay_txn_1"
    });
  });

  it("declines very large simulated payments", async () => {
    const service = new PaymentsService();

    await expect(
      service.authorize({
        transactionId: "txn_2",
        userId: "user-1",
        amount: 6000,
        currency: "USD"
      })
    ).resolves.toMatchObject({
      status: "declined"
    });
  });

  it("throws when the error fault is active", async () => {
    const service = new PaymentsService(undefined, undefined, faults({ mode: "error" }));

    await expect(service.authorize(baseRequest)).rejects.toThrow(
      /injected payment failure/
    );
  });

  it("triggers errors at the configured rate", async () => {
    const alwaysFail = new PaymentsService(
      undefined,
      undefined,
      faults({ errorRate: 0.5 }),
      () => 0.1
    );
    const neverFail = new PaymentsService(
      undefined,
      undefined,
      faults({ errorRate: 0.5 }),
      () => 0.9
    );

    await expect(alwaysFail.authorize(baseRequest)).rejects.toThrow();
    await expect(neverFail.authorize(baseRequest)).resolves.toMatchObject({
      status: "approved"
    });
  });
});
