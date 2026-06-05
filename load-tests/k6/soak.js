/* global __ENV */

import {
  defaultBaseUrl,
  summaryTrendStats,
  transactionFlow
} from "./transaction-flow.js";

// Soak profile (roadmap 9.5): hold a steady moderate load for a long duration to
// surface memory leaks, slow resource growth, and long-running instability.
// Defaults to 50 VUs for 30m; override VUS and DURATION for a longer soak.
const baseUrl = __ENV.BASE_URL || defaultBaseUrl;
const vus = Number(__ENV.VUS || 50);
const duration = __ENV.DURATION || "30m";
const warmup = __ENV.SOAK_WARMUP || "1m";

export const options = {
  scenarios: {
    soak: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: warmup, target: vus },
        { duration: duration, target: vus },
        { duration: "30s", target: 0 }
      ],
      gracefulRampDown: "30s",
      tags: {
        profile: "soak"
      }
    }
  },
  summaryTrendStats,
  thresholds: {
    // A soak should stay healthy the whole time; drift past these bounds is the
    // failure signal (leak, saturation, or degradation over time).
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"]
  }
};

export default function () {
  transactionFlow(baseUrl, {
    userPrefix: "soak-user",
    description: "TraceForge soak transaction"
  });
}
