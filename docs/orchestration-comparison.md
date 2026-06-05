# Orchestration Comparison — Compose vs Swarm vs Kubernetes

Generated at: 2026-06-05T13:37:06.695Z

## Overview

This compares three deployment targets for the same core stack (4 services + PostgreSQL, Redis, RabbitMQ). Docker Compose and Docker Swarm were deployed and measured live; the Kubernetes manifests are authored and statically validated (`kubeconform`) but not run here because no local cluster is present. Startup, scaling, and recovery numbers are from real deployments.

## Summary

| Target | Startup (s) | Config lines | Config bytes | Avg CPU % | Max memory (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Docker Compose | 33.6 | 323 | 10431 | 3.9 | 119.1 |
| Docker Swarm | 25.0 | 123 | 4010 | 1.5 | 135.4 |
| Kubernetes (not run) | n/a | 356 | 8595 | n/a | n/a |

## Scaling

| Target | Service | Change | Time (s) | Behaviour |
| --- | --- | --- | ---: | --- |
| Docker Compose | payment-service | 1→2 | n/a | failed: published host port conflict (Compose maps a fixed host port per service) |
| Docker Swarm | transaction-service | 1→3 | 32.6 | scaled via routing mesh |
| Docker Swarm | payment-service | 1→2 | 7.7 | scaled via routing mesh |
| Kubernetes (not run) | transaction-service | 2→5 | n/a | `HorizontalPodAutoscaler` (CPU 70%) in the manifest |

## Failure Recovery

| Target | Service | Recovery (s) | Behaviour |
| --- | --- | ---: | --- |
| Docker Compose | payment-service | n/a | no automatic recovery: container stayed "exited" (Compose does not reconcile desired state; manual `up -d` required) |
| Docker Swarm | transaction-service | 12.8 | task automatically rescheduled |
| Docker Swarm | payment-service | 16.9 | task automatically rescheduled |
| Kubernetes (not run) | any | n/a | ReplicaSet controller reschedules killed pods |

## Charts

![orchestration-startup.svg](../results/charts/orchestration-startup.svg)

![orchestration-recovery.svg](../results/charts/orchestration-recovery.svg)

![orchestration-config-size.svg](../results/charts/orchestration-config-size.svg)

## Operational Trade-offs

- **Docker Compose** — simplest config and the lowest barrier for local reproducibility, but it is not a reconciler: a killed container is not restarted, and host-port publishing prevents scaling a service beyond one replica without editing the file.
- **Docker Swarm** — adds a `deploy` block per service for replicas, restart policy, and resource limits. The routing mesh load-balances a single published port across replicas, and the orchestrator automatically reschedules killed tasks. Modest extra configuration over Compose; no startup ordering (`depends_on` is ignored), so services restart until dependencies are reachable.
- **Kubernetes** — the most configuration (Namespace, ConfigMap, Secret, PVC, Deployments, Services, HPA) and operational concepts, in exchange for the strongest scaling and self-healing primitives. Treated as optional challenge mode.

## Threats to Validity

- Single-node, single-run measurements on one machine; startup and recovery times depend on hardware, image cache, and Docker Desktop overhead.
- Swarm has no `depends_on` ordering, so its startup includes app-service restart loops until the datastores accept connections — a real but variable cost.
- Kubernetes was statically validated only; its runtime numbers are not measured and are intentionally left as `n/a`.

## Reproduce

```bash
# Requires Docker; builds are reused from the Compose images.
pnpm orchestration:run
```
