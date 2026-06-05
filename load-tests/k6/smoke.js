/* global __ENV */

import http from "k6/http";
import { check } from "k6";

const baseUrl = __ENV.BASE_URL || "http://localhost:3000";

export const options = {
  vus: 1,
  iterations: 4
};

export default function () {
  const responses = [
    http.get(`${baseUrl}/health`),
    http.get(__ENV.TRANSACTION_SERVICE_URL || "http://localhost:3001/health"),
    http.get(__ENV.PAYMENT_SERVICE_URL || "http://localhost:3002/health"),
    http.get(__ENV.WORKER_SERVICE_URL || "http://localhost:3003/health")
  ];

  for (const response of responses) {
    check(response, {
      "health endpoint returns 200": (res) => res.status === 200
    });
  }

  const createTransaction = http.post(
    `${baseUrl}/transactions`,
    JSON.stringify({
      userId: "k6-smoke-user",
      amount: 10,
      currency: "USD",
      description: "k6 smoke transaction"
    }),
    {
      headers: {
        "content-type": "application/json"
      }
    }
  );

  check(createTransaction, {
    "transaction can be created": (res) => res.status === 201
  });
}
