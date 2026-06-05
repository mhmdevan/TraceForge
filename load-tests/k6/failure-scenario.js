/* global __ENV */

import {
  defaultBaseUrl,
  summaryTrendStats,
  transactionFlow
} from "./transaction-flow.js";

// Shared definition for the failure-injection load profiles. Every failure script
// drives the same steady transaction load; the fault itself is injected through
// service environment variables (see docs/failure-injection-protocol.md), not here.
//
// Thresholds are intentionally absent: under an injected fault, errors and high
// latency are the expected signal, not a test failure.
export function failureOptions(scenario) {
  return {
    scenarios: {
      [scenario]: {
        executor: "constant-vus",
        vus: Number(__ENV.VUS || 20),
        duration: __ENV.DURATION || "2m",
        tags: {
          scenario
        }
      }
    },
    summaryTrendStats
  };
}

export function runFailureFlow(scenario) {
  transactionFlow(__ENV.BASE_URL || defaultBaseUrl, {
    userPrefix: `${scenario}-user`,
    description: `TraceForge ${scenario}`
  });
}
