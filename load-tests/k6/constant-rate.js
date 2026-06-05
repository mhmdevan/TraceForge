/* global __ENV */

import {
  defaultBaseUrl,
  summaryTrendStats,
  transactionFlow
} from "./transaction-flow.js";

// Open-model load: a constant ARRIVAL RATE (requests/second) rather than a fixed
// number of virtual users. This decouples offered load from system response time
// — a slower (more-instrumented) system does not get an easier workload — which
// is the correct model for measuring server-side overhead. Used by the realistic
// load harness (scripts/run-load-experiment.ts) for ISI-grade measurement.
const baseUrl = __ENV.BASE_URL || defaultBaseUrl;
const rate = Number(__ENV.RATE || 150);
const duration = __ENV.DURATION || "30s";
const preAllocatedVUs = Number(__ENV.PRE_ALLOCATED_VUS || 20);
const maxVUs = Number(__ENV.MAX_VUS || 200);

export const options = {
  scenarios: {
    constant_rate: {
      executor: "constant-arrival-rate",
      rate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs,
      maxVUs,
      tags: { load: "constant-rate" }
    }
  },
  summaryTrendStats,
  // Diagnostic only: at saturation the system will drop or slow requests, which is
  // itself a measurement, not a test failure.
  thresholds: {
    http_req_failed: ["rate<0.10"]
  }
};

export default function () {
  // No think-time: the arrival-rate executor controls pacing in the open model.
  transactionFlow(baseUrl, {
    userPrefix: "load-user",
    description: "TraceForge constant-rate load",
    thinkTime: 0
  });
}
