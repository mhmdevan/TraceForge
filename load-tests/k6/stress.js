/* global __ENV */

import {
  defaultBaseUrl,
  summaryTrendStats,
  transactionFlow
} from "./transaction-flow.js";

// Stress profile (roadmap 9.3): step the load up 50 -> 100 -> 200 -> 500 VUs to
// find the point where the system starts degrading. Each step ramps then holds
// so the latency, throughput, and error-rate curves are readable per level.
const baseUrl = __ENV.BASE_URL || defaultBaseUrl;
const ramp = __ENV.STRESS_RAMP || "1m";
const hold = __ENV.STRESS_HOLD || "2m";

export const options = {
  scenarios: {
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: ramp, target: 50 },
        { duration: hold, target: 50 },
        { duration: ramp, target: 100 },
        { duration: hold, target: 100 },
        { duration: ramp, target: 200 },
        { duration: hold, target: 200 },
        { duration: ramp, target: 500 },
        { duration: hold, target: 500 },
        { duration: ramp, target: 0 }
      ],
      gracefulRampDown: "30s",
      tags: {
        profile: "stress"
      }
    }
  },
  summaryTrendStats,
  thresholds: {
    // Diagnostic only: a stress test is meant to find the degradation point, so
    // these bounds are wide and should not be read as pass/fail SLOs.
    http_req_failed: ["rate<0.25"],
    checks: ["rate>0.75"]
  }
};

export default function () {
  transactionFlow(baseUrl, {
    userPrefix: "stress-user",
    description: "TraceForge stress transaction"
  });
}
