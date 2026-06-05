/* global __ENV */

import {
  defaultBaseUrl,
  summaryTrendStats,
  transactionFlow
} from "./transaction-flow.js";

// Spike profile (roadmap 9.4): hold a low baseline, jump 10 -> 300 VUs suddenly,
// then drop back to 10 and hold so recovery time, error spike, p99 spike, and
// RabbitMQ queue buildup/drain can be observed.
const baseUrl = __ENV.BASE_URL || defaultBaseUrl;

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 },
        { duration: "1m", target: 10 },
        { duration: "30s", target: 300 },
        { duration: "2m", target: 300 },
        { duration: "30s", target: 10 },
        { duration: "2m", target: 10 },
        { duration: "30s", target: 0 }
      ],
      gracefulRampDown: "30s",
      tags: {
        profile: "spike"
      }
    }
  },
  summaryTrendStats,
  thresholds: {
    // Diagnostic only: errors are expected during the spike; the interesting
    // signal is how fast latency and error rate recover afterwards.
    http_req_failed: ["rate<0.2"],
    checks: ["rate>0.8"]
  }
};

export default function () {
  transactionFlow(baseUrl, {
    userPrefix: "spike-user",
    description: "TraceForge spike transaction"
  });
}
