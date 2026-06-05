# Baseline Without Observability

Phase 3 measures the raw system before metrics, structured logs, traces, or an
OpenTelemetry Collector are enabled.

## Mode

```bash
OBS_MODE=none
```

In this mode:

- Nest framework logs are disabled.
- The shared structured JSON logger is not used at service startup.
- Metrics endpoints are not enabled.
- Tracing is not enabled.
- OpenTelemetry Collector is not part of the base Compose stack.

## Command

```bash
OBS_MODE=none pnpm baseline:run
```

The command performs:

- a smoke check,
- three baseline load-test runs,
- Docker CPU and memory sampling,
- raw result storage,
- processed CSV generation,
- report generation.

## Outputs

- `results/raw/baseline-*/k6-summary-run-*.json`
- `results/raw/baseline-*/docker-stats-run-*.json`
- `results/processed/baseline-summary.csv`
- `results/reports/baseline-summary.md`
