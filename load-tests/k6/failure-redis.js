import { failureOptions, runFailureFlow } from "./failure-scenario.js";

// F5 — Redis unavailable. Start the stack with the Redis fault:
//   REDIS_DISABLED=true docker compose ... up -d
// (or REDIS_TIMEOUT_RATE=0.1 to inject intermittent cache latency instead)
// Expected symptom: cache miss + latency. Best tool: logs + metrics.
export const options = failureOptions("redis-unavailable");

export default function () {
  runFailureFlow("redis-unavailable");
}
