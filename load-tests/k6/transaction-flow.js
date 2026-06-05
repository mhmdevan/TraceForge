/* global __ITER, __VU */

import http from "k6/http";
import { check, sleep } from "k6";

// Default API Gateway entry point. Override with BASE_URL.
export const defaultBaseUrl = "http://localhost:3000";

// Shared trend statistics so every load profile reports the same percentiles.
export const summaryTrendStats = ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"];

// Runs one full transaction flow: create -> read -> user history.
// This mirrors load-tests/k6/baseline.js exactly so the stress, spike, and soak
// profiles drive the same code path and stay comparable to the baseline runs.
export function transactionFlow(baseUrl, flowOptions = {}) {
  const userPrefix = flowOptions.userPrefix || "load-user";
  const description = flowOptions.description || "TraceForge load transaction";
  const thinkTime = flowOptions.thinkTime === undefined ? 0.1 : flowOptions.thinkTime;
  const userId = `${userPrefix}-${__VU}`;

  const createResponse = http.post(
    `${baseUrl}/transactions`,
    JSON.stringify({
      userId,
      amount: 25 + (__ITER % 10),
      currency: "USD",
      description
    }),
    {
      headers: {
        "content-type": "application/json"
      },
      tags: {
        flow: "create_transaction"
      }
    }
  );

  const created = check(createResponse, {
    "transaction create returns 201": (response) => response.status === 201
  });

  if (!created) {
    sleep(thinkTime);
    return;
  }

  const transaction = createResponse.json("transaction");
  const transactionId = transaction && transaction.id;

  check(transaction, {
    "transaction is approved or declined": (value) =>
      Boolean(value) && (value.status === "approved" || value.status === "declined")
  });

  if (transactionId) {
    const readResponse = http.get(`${baseUrl}/transactions/${transactionId}`, {
      tags: {
        flow: "read_transaction"
      }
    });

    check(readResponse, {
      "transaction read returns 200": (response) => response.status === 200
    });
  }

  const historyResponse = http.get(`${baseUrl}/users/${userId}/transactions`, {
    tags: {
      flow: "user_history"
    }
  });

  check(historyResponse, {
    "user history returns 200": (response) => response.status === 200
  });

  sleep(thinkTime);
}
