import { failureOptions, runFailureFlow } from "./failure-scenario.js";

// F2 — payment 500 errors. Start the stack with the payment error fault:
//   PAYMENT_ERROR_RATE=0.2 docker compose ... up -d
// Expected symptom: error rate spike. Best tool: metrics + logs.
export const options = failureOptions("payment-errors");

export default function () {
  runFailureFlow("payment-errors");
}
