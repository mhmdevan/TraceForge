import { describe, expect, it } from "vitest";
import {
  assertCreateTransactionRequest,
  OBSERVABILITY_MODES,
  SERVICE_NAMES
} from "./index";

describe("contracts", () => {
  it("lists the phase-one services", () => {
    expect(SERVICE_NAMES).toEqual([
      "api-gateway",
      "transaction-service",
      "payment-service",
      "worker-service"
    ]);
  });

  it("keeps all planned observability modes explicit", () => {
    expect(OBSERVABILITY_MODES).toContain("none");
    expect(OBSERVABILITY_MODES).toContain("otel_full");
  });

  it("normalizes a valid create transaction request", () => {
    expect(
      assertCreateTransactionRequest({
        userId: " user-1 ",
        amount: 42.5,
        currency: "USD",
        description: " test "
      })
    ).toEqual({
      userId: "user-1",
      amount: 42.5,
      currency: "USD",
      description: "test"
    });
  });

  it("rejects invalid transaction amounts", () => {
    expect(() =>
      assertCreateTransactionRequest({
        userId: "user-1",
        amount: 0,
        currency: "USD"
      })
    ).toThrow(/amount/);
  });
});
