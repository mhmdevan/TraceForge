import { failureOptions, runFailureFlow } from "./failure-scenario.js";

// F1 — slow payment. Start the stack with the payment delay fault:
//   PAYMENT_MODE=slow PAYMENT_DELAY_MS=1000 docker compose ... up -d
// Expected symptom: high latency. Best tool: traces (payment.authorize span).
export const options = failureOptions("payment-slow");

export default function () {
  runFailureFlow("payment-slow");
}
