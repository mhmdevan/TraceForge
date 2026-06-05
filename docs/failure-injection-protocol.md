# Failure Injection and Debuggability Protocol

This protocol defines how Phase 9 failures are injected and how detection and
root-cause times are measured. The goal is to compare how quickly a fault can be
detected and diagnosed under different observability modes (baseline `none` vs the
intermediate modes vs `otel_full`).

The failure mechanisms are real code in the services, toggled by environment
variables. The detection and root-cause **times are measured by a human** following
the steps below — they are not, and must not be, fabricated. See the anti-goals in
the roadmap: "Do not manually fake experiment results."

## Scenario matrix

| ID  | Scenario                  | Service             | Inject with                                           | Expected symptom     | Best tool           |
| --- | ------------------------- | ------------------- | ----------------------------------------------------- | -------------------- | ------------------- |
| F1  | Slow payment              | payment-service     | `PAYMENT_MODE=slow PAYMENT_DELAY_MS=1000`             | high latency         | traces              |
| F2  | Payment 500 errors        | payment-service     | `PAYMENT_ERROR_RATE=0.2`                              | error rate spike     | metrics + logs      |
| F3  | Slow DB query             | transaction-service | `DB_SLOW_QUERY=true DB_SLOW_QUERY_DELAY_MS=500`       | p95 increase         | traces + DB metrics |
| F4  | RabbitMQ consumer stopped | worker-service      | `WORKER_DISABLED=true`                                | queue lag            | metrics             |
| F5  | Redis unavailable         | transaction-service | `REDIS_DISABLED=true`                                 | cache miss + latency | logs + metrics      |
| F6  | Memory pressure           | transaction-service | `MEMORY_PRESSURE_ENABLED=true MEMORY_PRESSURE_MB=256` | latency/error growth | metrics             |

Additional flags exist for finer control: `PAYMENT_TIMEOUT_RATE`,
`DB_CONNECTION_ERROR_RATE`, `REDIS_TIMEOUT_RATE`, `WORKER_PROCESSING_DELAY_MS`,
`WORKER_ERROR_RATE`, and `MEMORY_PRESSURE_LEAK_MB_PER_MIN`. All faults default to
off, so a normally started stack is unaffected.

## Running a scenario

1. Start the stack in the mode under test. For the baseline:

   ```bash
   OBS_MODE=none PAYMENT_MODE=slow PAYMENT_DELAY_MS=1000 \
     docker compose -f infra/docker/compose/docker-compose.base.yml up --build -d
   pnpm migrate:postgres
   ```

   For the full pipeline, use `OBS_MODE=otel_full` with the metrics, logs, traces,
   and otel profiles (see the README Phase 7 command) plus the same fault flags.

2. Start the matching k6 failure script and note the wall-clock start as `T0`
   (the failure start timestamp):

   ```bash
   k6 run load-tests/k6/failure-payment-slow.js
   ```

3. Follow the manual debugging protocol below. Do **not** read the service source
   code. Use only the telemetry available in the current `OBS_MODE`.

4. Record the observation in `experiments/failure-injection/observations.json`
   (copy `observations.example.json` as a starting point and set
   `"status": "measured"`).

## Manual debugging protocol (per run)

1. Note `failureStartTimestamp` (`T0`) when the fault is injected.
2. Watch the available telemetry. Record `firstVisibleSymptomTimestamp` the moment
   the issue is first visible (a dashboard, a log line, a trace, or a failing
   request).
3. Record `firstAlertTimestamp` if an alert fires (modes with Prometheus alerts).
4. Diagnose the root cause using only telemetry. Record
   `rootCauseIdentifiedTimestamp` when you can name the faulty component and reason.
5. Record `toolsUsed` (e.g. Grafana, Jaeger, Loki, `docker stats`), `manualSteps`
   (a rough count of distinct actions), and `rootCauseAccuracy`
   (`correct` | `partial` | `incorrect`).

## Derived measurements

The report generator computes, per scenario and mode:

- `time_to_detect_seconds = (firstAlert ?? firstVisibleSymptom) - failureStart`
- `time_to_root_cause_seconds = rootCauseIdentified - failureStart`

and, per scenario, the debuggability improvement of `otel_full` over the baseline:

- `detect_improvement_percent = (detect_none - detect_otel) / detect_none * 100`
- `root_cause_improvement_percent = (rc_none - rc_otel) / rc_none * 100`

## Generating the report

```bash
pnpm failure:report
```

This reads the observations file and writes:

- `results/processed/debuggability-results.csv`
- `results/charts/detection-time.svg` and `results/charts/root-cause-time.svg`
- `docs/failure-injection-report.md`

Until real runs are recorded, the generator reads
`observations.example.json` and clearly stamps every output as an
illustrative example rather than measured data.
