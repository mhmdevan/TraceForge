import { describe, expect, it } from "vitest";
import { runWithCorrelationId } from "@traceforge/logger";
import { TransactionsController } from "./transactions.controller";
import { TransactionsGatewayClient } from "./transactions.gateway-client";

describe("transactions gateway", () => {
  it("forwards create transaction requests to the transaction service", async () => {
    const client = {
      createTransaction: async () => ({
        transaction: {
          id: "txn_1",
          userId: "user-1",
          amount: 25,
          currency: "USD",
          status: "approved",
          paymentStatus: "approved",
          createdAt: "2026-06-02T00:00:00.000Z",
          updatedAt: "2026-06-02T00:00:00.000Z"
        }
      })
    } as unknown as TransactionsGatewayClient;
    const controller = new TransactionsController(client);

    await expect(
      controller.createTransaction({
        userId: "user-1",
        amount: 25,
        currency: "USD"
      })
    ).resolves.toMatchObject({
      transaction: {
        id: "txn_1",
        status: "approved"
      }
    });
  });

  it("rejects invalid transaction requests before proxying", async () => {
    const client = {
      createTransaction: async () => {
        throw new Error("should not be called");
      }
    } as unknown as TransactionsGatewayClient;
    const controller = new TransactionsController(client);

    await expect(
      controller.createTransaction({
        userId: "user-1",
        amount: -1,
        currency: "USD"
      })
    ).rejects.toThrow(/amount/);
  });
});

describe("transactions gateway client", () => {
  it("propagates the active correlation id to downstream requests", async () => {
    let headers: Record<string, string> | undefined;
    const client = new TransactionsGatewayClient("http://transaction-service", (async (
      _url,
      init
    ) => {
      headers = init?.headers as Record<string, string> | undefined;
      return new Response(
        JSON.stringify({
          transaction: {
            id: "txn_1",
            userId: "user-1",
            amount: 25,
            currency: "USD",
            status: "approved",
            paymentStatus: "approved",
            createdAt: "2026-06-02T00:00:00.000Z",
            updatedAt: "2026-06-02T00:00:00.000Z"
          }
        }),
        {
          status: 201,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }) as typeof fetch);

    await runWithCorrelationId("corr_gateway", () =>
      client.createTransaction({
        userId: "user-1",
        amount: 25,
        currency: "USD"
      })
    );

    expect(headers).toMatchObject({
      "x-correlation-id": "corr_gateway"
    });
  });
});
