import { failureOptions, runFailureFlow } from "./failure-scenario.js";

// F3 — slow database query. Start the stack with the DB slow-query fault:
//   DB_SLOW_QUERY=true DB_SLOW_QUERY_DELAY_MS=500 docker compose ... up -d
// Expected symptom: p95 increase. Best tool: traces + DB query metrics.
export const options = failureOptions("db-slow");

export default function () {
  runFailureFlow("db-slow");
}
