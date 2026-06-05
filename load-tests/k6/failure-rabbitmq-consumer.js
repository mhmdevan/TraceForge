import { failureOptions, runFailureFlow } from "./failure-scenario.js";

// F4 — RabbitMQ consumer stopped. Start the stack with the worker disabled:
//   WORKER_DISABLED=true docker compose ... up -d
// Expected symptom: queue lag (published events are never consumed). Best tool:
// metrics (RabbitMQ queue depth / consume rate).
export const options = failureOptions("rabbitmq-consumer");

export default function () {
  runFailureFlow("rabbitmq-consumer");
}
