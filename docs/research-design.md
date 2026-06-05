# Research Design

The project is experiment-first. Phase 1 only establishes the code and runtime
foundation required by the later measurement phases.

The initial independent variable already appears in configuration as `OBS_MODE`:

- `none`
- `metrics`
- `metrics_logs`
- `metrics_logs_traces`
- `otel_full`

Later phases will attach instrumentation and collect latency, throughput, error rate,
CPU, memory, network, log volume, and trace volume metrics for each mode.
