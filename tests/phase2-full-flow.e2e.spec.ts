import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { CreateTransactionResponse } from "@traceforge/contracts";

const runE2e = process.env.RUN_E2E === "true";
const gatewayUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://traceforge:traceforge@localhost:15432/traceforge";
const pool = new Pool({
  connectionString: databaseUrl
});

describe.skipIf(!runE2e)("phase 2 full transaction flow", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("creates a transaction through the gateway and persists the worker event", async () => {
    const createResponse = await fetch(`${gatewayUrl}/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        userId: "e2e-user",
        amount: 42,
        currency: "USD",
        description: "Phase 2 e2e transaction"
      })
    });

    expect(createResponse.status).toBe(201);

    const body = (await createResponse.json()) as CreateTransactionResponse;

    expect(body.transaction).toMatchObject({
      userId: "e2e-user",
      amount: 42,
      currency: "USD",
      status: "approved",
      paymentStatus: "approved"
    });

    const readResponse = await fetch(`${gatewayUrl}/transactions/${body.transaction.id}`);
    expect(readResponse.status).toBe(200);

    const historyResponse = await fetch(`${gatewayUrl}/users/e2e-user/transactions`);
    expect(historyResponse.status).toBe(200);

    await waitForPersistedEvent(body.transaction.id);
  });
});

async function waitForPersistedEvent(transactionId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await pool.query<{ count: string }>(
      "SELECT count(*) FROM transaction_events WHERE transaction_id = $1",
      [transactionId]
    );

    if (Number(result.rows[0]?.count ?? 0) > 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`No worker event persisted for transaction ${transactionId}`);
}
