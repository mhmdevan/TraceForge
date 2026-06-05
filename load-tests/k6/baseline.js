/* global __ENV, __ITER, __VU */

import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = __ENV.BASE_URL || "http://localhost:3000";

export const options = {
  vus: Number(__ENV.VUS || 4),
  duration: __ENV.DURATION || "8s",
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"]
  }
};

export default function () {
  const userId = `baseline-user-${__VU}`;
  const createResponse = http.post(
    `${baseUrl}/transactions`,
    JSON.stringify({
      userId,
      amount: 25 + (__ITER % 10),
      currency: "USD",
      description: "Phase 3 baseline transaction"
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
    sleep(0.1);
    return;
  }

  const transaction = createResponse.json("transaction");
  const transactionId = transaction && transaction.id;

  check(transaction, {
    "transaction is approved or declined": (value) =>
      value.status === "approved" || value.status === "declined"
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

  sleep(0.1);
}
