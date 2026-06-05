# Experiment Matrix

| Phase | Mode                  | Load profile    | Failure scenario  | Output                                   |
| ----- | --------------------- | --------------- | ----------------- | ---------------------------------------- |
| 3     | `none`                | smoke, baseline | none              | baseline latency and resource usage      |
| 4     | `metrics`             | baseline        | none              | metrics overhead                         |
| 5     | `metrics_logs`        | baseline        | none              | logging overhead                         |
| 6     | `metrics_logs_traces` | baseline        | slow payment      | tracing overhead and trace evidence      |
| 7     | `otel_full`           | baseline        | selected failures | collector overhead and unified telemetry |
