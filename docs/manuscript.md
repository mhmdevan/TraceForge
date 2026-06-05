# Measuring the Performance Cost and Debuggability Value of Observability in Containerized Microservices: A Controlled, Reproducible Study

**Mohammad Eslamnia**
Department of Mathematical Support and Administration of Information Systems,
Institute of Intelligent Systems and Technologies,
Peter the Great St. Petersburg Polytechnic University
ORCID: 0009-0001-0014-8000 · `mhmd.esm3@gmail.com`

**Artifact:** https://github.com/mhmdevan/TraceForge · **DOI:** [10.5281/zenodo.20561281](https://doi.org/10.5281/zenodo.20561281)

> **Manuscript draft.** Journal-agnostic IMRaD draft generated from the project's
> experimental record. All numbers are measured (see `docs/statistics-load-report.md`,
> `docs/mttd-report.md`, `docs/postgres-indexing-report.md`). Before submission, convert
> to the target venue's template (e.g. IEEE/Elsevier/Springer LaTeX), verify every
> reference against its primary source, and replace the preliminary micro-benchmark
> discussion if the full multi-load sweep (Section 8) is completed first.

---

## Abstract

Observability instrumentation — metrics, structured logs, and distributed traces — is
ubiquitous in microservice systems, yet its runtime cost is frequently assumed rather
than measured, and the debugging benefit it is presumed to deliver is rarely quantified
objectively. We present a controlled, experiment-first study of both halves of this
trade-off on a single containerized transaction-processing microservice system. A single
environment switch selects among five additive observability depths — none, metrics,
metrics+logs, metrics+logs+traces, and a full OpenTelemetry Collector pipeline — so that
each depth runs identical application code against a true uninstrumented baseline. The
primary overhead evaluation drives each depth with an open-model (constant-arrival-rate)
workload, repeats it ten times in randomized order, and analyzes the non-normal results
non-parametrically (median and IQR, bootstrap 95% confidence intervals, Kruskal–Wallis,
Mann–Whitney U, and Cliff's delta). Relative to baseline, metrics-only instrumentation is
not statistically distinguishable (CPU and median-latency confidence intervals overlap
baseline); structured logging is the single largest contributor (CPU +164%, median
latency +177%, both p < 0.001, Cliff's δ = 1.0) and induces severe tail-latency spikes;
and the full OpenTelemetry pipeline, despite carrying the most telemetry, holds CPU near
the tracing level (+51%) with the lowest latency variance, owing to its batched,
asynchronous export. We then measure the debuggability benefit objectively as
mean-time-to-detect (MTTD): the time from fault onset to a Prometheus alert firing.
Without a metrics pipeline an injected fault — a 12% error rate or a one-second p95
latency — is real but automatically undetectable, whereas any metrics-bearing depth
detects it within roughly one scrape interval (≈9 s to pending) and pages within the
alert debounce (≈70 s) — a step change rather than a gradient. A throughput sweep further
shows that the heavier pipelines chiefly reduce maximum sustainable throughput: the full
pipeline saturates at less than half of the baseline's capacity. We complement these with
secondary results on database indexing at one million rows and container-orchestration
trade-offs. All code, raw and processed data, and figures are released as a versioned,
DOI-archived reproducibility artifact.

**Keywords:** observability; microservices; OpenTelemetry; performance evaluation;
distributed tracing; benchmarking methodology; reproducible research.

---

## 1. Introduction

A recurring pattern in microservice engineering is to add observability tooling —
Prometheus metrics, JSON logs shipped to a backend such as Loki, OpenTelemetry traces —
and to assume that the cost is negligible relative to the operational benefit. That
assumption is seldom tested under controlled conditions on the same system, with the same
workload, against a true uninstrumented baseline; and the benefit side of the trade-off —
how much faster a problem is detected or diagnosed — is even more rarely measured
objectively rather than asserted.

This paper studies both sides of that trade-off on a deliberately measurement-oriented
testbed, **TraceForge**. Rather than demonstrating that a microservice application works,
the system is built as an instrument that can be run repeatedly to quantify the cost of
observability and the value it provides. We address two research questions:

- **RQ1 (Overhead).** How does each incremental level of observability instrumentation
  affect latency, CPU usage, memory usage, and telemetry volume, relative to an
  uninstrumented baseline?
- **RQ2 (Debuggability).** How much does observability reduce the time to _detect_ a
  fault?

We answer RQ1 with a statistically powered, open-model load campaign, and the _detection_
half of RQ2 with a fully automated, objective MTTD measurement. The _root-cause_ half of
RQ2 — how much logs and traces accelerate human diagnosis — requires a controlled operator
study and is left as future work; we report the implemented protocol but no human timings.

The contributions of this paper are:

1. **An incremental, baseline-anchored methodology** and an open testbed for measuring the
   cost of _progressively_ deeper observability on one system, jointly accounting for
   latency, CPU, memory, and telemetry volume.
2. **A statistically rigorous overhead result** (RQ1) using open-model load, N = 10
   repetitions, bootstrap confidence intervals, and non-parametric inference, which
   isolates structured logging as the dominant cost and shows the batched OpenTelemetry
   pipeline to be comparatively smooth.
3. **An objective debuggability result** (RQ2, detection): MTTD measured as the time from
   fault onset to alert firing, revealing a step change from "undetectable" without a
   metrics pipeline to bounded, configurable detection with one.
4. **Secondary controlled comparisons** of database indexing at one million rows
   (PostgreSQL and MongoDB) and of container orchestration platforms.
5. **A complete, DOI-archived reproducibility artifact** in which every figure and dataset
   is regenerable from source.

## 2. Related Work

**Microservice observability.** Observability is conventionally organized around three
"pillars" — metrics, logs, and traces — that together let operators infer internal state
from external signals; industrial surveys report that teams adopt tracing-and-analysis
pipelines with explicit cost/benefit trade-offs and that correlating signals across
services is a recurring pain point (_Enjoy your observability_, Empirical Software
Engineering, 2022; the Queen's University Belfast observability survey, 2022). Distributed
tracing has a well-established lineage from Google's Dapper (Sigelman et al., 2010) through
Pivot Tracing (Mace et al., 2015) and Canopy (Kaldor et al., 2017); OpenTelemetry and the
W3C Trace Context recommendation have since standardized signal generation and propagation.

**The cost of observability.** Empirical studies of OpenTelemetry report low single-digit
percentage CPU overhead under realistic load, sensitive to language/runtime and to
manual-versus-automatic instrumentation (e.g. an Umeå University thesis, 2024; comparative
OpenTelemetry benchmarking studies, 2024; the Kieker/MooBench line of monitoring-overhead
microbenchmarks, revisited for cloud profilers, 2024). Most such studies isolate a single
pillar or compare a binary instrumented-versus-not condition; few measure the _incremental_
cost of progressively deeper observability on the same system against a true uninstrumented
baseline, and headline figures vary by more than an order of magnitude largely because of
differing load regimes — motivating the controlled, mode-by-mode design used here.

**Benchmarking methodology.** Performance evaluations are frequently under-powered and
under-reported. Georges et al. (2007) showed that naïve best-of-N summaries mislead and
argued for confidence-interval-based comparison; Kalibera and Jones (2013) formalized
repetition budgeting. Because latency distributions are heavy-tailed, the appropriate tools
are non-parametric: Arcuri and Briand (2014) provide the canonical software-engineering
guidance — report median and dispersion, test with the Mann–Whitney U test (Mann and
Whitney, 1947) and its k-group generalization Kruskal–Wallis (Kruskal and Wallis, 1952),
and pair every p-value with a standardized effect size such as Cliff's delta (Cliff, 1993)
or Vargha–Delaney A₁₂ (Vargha and Delaney, 2000); bootstrap resampling (Efron and
Tibshirani, 1993) yields distribution-free confidence intervals. This study adopts exactly
this apparatus.

**Failure injection and debuggability.** Deliberate fault injection underlies chaos
engineering (Basiri et al., 2016); surveys of automated log analysis (He et al., 2021)
catalogue the diagnostic value of telemetry. The debuggability benefit, however, is usually
treated qualitatively; quantifying detection time objectively, as we do, is comparatively
rare. A full thematic review with citations is provided in the artifact
(`docs/related-work.md`).

## 3. System Under Study

The application domain is transaction processing, chosen because a single request naturally
exercises a database write, a read-heavy query, an external service call, and asynchronous
event handling. One request path crosses every relevant boundary:

```
POST /transactions
  -> API Gateway
  -> Transaction Service
       -> PostgreSQL (write)  -> Redis (cache)
       -> Payment Service (HTTP)  -> RabbitMQ (publish)
            -> Worker Service (consume)  -> PostgreSQL (persist event)
```

Four NestJS/TypeScript services participate (API Gateway, Transaction, Payment, Worker),
supported by five shared packages that centralize contracts, typed configuration,
structured logging, the Prometheus registry, and the OpenTelemetry SDK. Crucially, each
observability layer degrades to a no-op when its mode is inactive, so **the same binaries
run in every mode** and only instrumentation changes. Observability depth is selected by a
single `OBS_MODE` environment variable spanning five additive levels (Table 1). Backends
(Prometheus, Loki, Jaeger, the OpenTelemetry Collector, Grafana) are attached through
Docker Compose profiles so each mode starts exactly the components it needs.

**Table 1. Observability modes.**

| `OBS_MODE`            | Metrics | Logs | Traces | Collector |
| --------------------- | :-----: | :--: | :----: | :-------: |
| `none` (baseline)     |    —    |  —   |   —    |     —     |
| `metrics`             |    ✓    |  —   |   —    |     —     |
| `metrics_logs`        |    ✓    |  ✓   |   —    |     —     |
| `metrics_logs_traces` |    ✓    |  ✓   |   ✓    |     —     |
| `otel_full`           |    ✓    |  ✓   |   ✓    |     ✓     |

## 4. Methodology

### 4.1 Experimental design

**Workload.** A single k6 scenario drives the full transaction flow (`create → read →
user history`). For the primary overhead evaluation we use an **open-model**
(constant-arrival-rate) load at approximately 90 requests/second — deliberately below the
saturation point of the heaviest mode so that we measure steady-state overhead rather than
saturation. The open model is essential: under a closed model a slower (instrumented)
system receives a lighter offered load, biasing the comparison.

**Repetition and ordering.** Each of the five modes is measured in **N = 10** repetitions.
A warm-up run precedes the measured runs and is discarded. Mode order is randomized (seeded)
to mitigate ordering and thermal drift. Images are rebuilt from current source before the
campaign so that each mode runs current code rather than a stale container image.

**Resource and telemetry accounting.** Per run we capture k6 latency percentiles, Docker
CPU and memory statistics, and telemetry volume (log entries and spans per request).

### 4.2 Statistical analysis

Latency and resource distributions are non-normal, so the analysis is non-parametric
throughout. We report the **median** and **IQR** for central tendency and spread, and a
**bootstrap 95% confidence interval of the median** (5,000 resamples, seeded). Across modes
we use the **Kruskal–Wallis** H test; against baseline we use a two-sided **Mann–Whitney U**
test with continuity and tie correction, paired with **Cliff's delta** as a standardized
effect size. As a conservative decision aid, a mode whose 95% CI does _not_ overlap the
baseline's CI is taken to differ from baseline with high confidence. The statistics library
is unit-tested against textbook values, and the bootstrap is seeded for exact
reproducibility.

### 4.3 Objective MTTD (RQ2, detection)

Detection is measured with no human in the loop. Each fault is injected into a freshly
built stack; an open-model load is applied at a recorded onset time `T0`; and the relevant
Prometheus alert is polled until it becomes **active (pending)** and then **firing**. MTTD
is the elapsed time from `T0`. The baseline mode has no metrics pipeline, so no alert can
fire — automated detection is impossible by construction, which is itself the key contrast.

### 4.4 Environment

All experiments ran on an Apple M4 (10 logical cores), 16 GiB RAM, macOS, Docker 20.10.16
(Compose v2), Node.js 20.19. The exact environment, including container image digests, is
recorded machine-readably in the artifact (`results/environment.json`).

## 5. Results

### 5.1 RQ1 — Observability overhead (primary)

Kruskal–Wallis confirms that the five modes differ overall on every metric (CPU
H = 24.2, p < 0.001; p50 latency H = 23.1, p < 0.001; p95 latency H = 16.2, p = 0.003;
memory H = 30.0, p < 0.001). Table 2 reports CPU overhead, the most load-robust metric, and
Table 3 reports median (p50) latency.

**Table 2. CPU overhead by mode (N = 10; median [95% CI]).**

| Mode                    | CPU % [95% CI]    | Overhead |  MWU p | Cliff's δ    | Differs?              |
| ----------------------- | ----------------- | -------: | -----: | ------------ | --------------------- |
| Baseline                | 5.6 [5.3, 7.2]    |        — |      — | —            | —                     |
| Metrics                 | 8.3 [5.2, 13.6]   |     +48% |   0.34 | 0.26 (small) | no (CI overlaps)      |
| Metrics + Logs          | 14.9 [13.7, 19.6] |    +164% | <0.001 | 1.00 (large) | **yes**               |
| Metrics + Logs + Traces | 8.9 [8.2, 13.2]   |     +59% |  0.003 | 0.80 (large) | **yes**               |
| Full OpenTelemetry      | 8.5 [7.2, 9.6]    |     +51% |  0.011 | 0.68 (large) | borderline (overlaps) |

**Table 3. Median (p50) latency by mode (N = 10; median [95% CI]).**

| Mode                    | p50 ms [95% CI]    | Overhead |  MWU p | Differs?         |
| ----------------------- | ------------------ | -------: | -----: | ---------------- |
| Baseline                | 1.72 [1.64, 1.91]  |        — |      — | —                |
| Metrics                 | 2.71 [1.64, 5.28]  |     +58% |   0.31 | no (CI overlaps) |
| Metrics + Logs          | 4.77 [4.10, 16.92] |    +177% | <0.001 | **yes**          |
| Metrics + Logs + Traces | 2.89 [2.49, 4.55]  |     +69% | <0.001 | **yes**          |
| Full OpenTelemetry      | 3.33 [2.68, 4.05]  |     +94% | <0.001 | **yes**          |

Three findings are robust:

1. **Metrics are essentially free.** Metrics-only overhead is not statistically
   distinguishable from baseline for either CPU (p = 0.34) or median latency (p = 0.31);
   both confidence intervals overlap baseline.
2. **Structured logging is the dominant cost.** Metrics + Logs has the highest CPU (+164%)
   and median latency (+177%), both highly significant (p < 0.001, δ = 1.00, non-overlapping
   CIs). Synchronous log shipping also produced severe p95 tail-latency spikes — one run
   reached approximately 4.8 s — making Metrics + Logs the only mode whose p95 CI excludes
   baseline.
3. **The batched OpenTelemetry pipeline is comparatively smooth.** The full pipeline carries
   the most telemetry (≈5.7 log entries and ≈6.7 spans per request) yet holds CPU near the
   tracing level (+51%) and exhibits the lowest latency variance among instrumented modes;
   its asynchronous, batched export avoids the per-request stalls that synchronous logging
   induces.

We caution that absolute _latency_ percentages remain sensitive to the load point: a
≈5 ms baseline makes small absolute additions large in relative terms. The CPU result and
the qualitative ordering of modes are the load-robust conclusions.

**Load sensitivity (throughput sweep).** To characterize that load-dependence directly, we
swept baseline, Metrics + Logs, and Full OpenTelemetry across offered rates from 60 to 480
req/s (Table 5, Figure 1). At 60 req/s all three modes lie within roughly 10–40 ms p95,
confirming that the overhead is small in absolute terms at low load. As load rises the
curves diverge sharply and the modes saturate **in order of instrumentation depth**:
baseline sustains the full 480 req/s (achieved ≈ offered, p95 flat near 5–9 ms);
Metrics + Logs falls behind beyond ≈240 req/s; and Full OpenTelemetry saturates earliest,
its achieved throughput plateauing near 220 req/s — **less than half of baseline's** — with
p95 latency rising into the multi-second range past its knee. The dominant practical cost of
the heavier pipelines is therefore not a fixed per-request tax but a **reduction in maximum
sustainable throughput**.

**Table 5. Throughput sweep (median of 3 reps per point).**

| Offered req/s | Baseline p95 / achieved | Metrics+Logs p95 / achieved | Full OTel p95 / achieved |
| ------------: | ----------------------- | --------------------------- | ------------------------ |
|            60 | 7 ms / 60               | 10 ms / 60                  | 34 ms / 60               |
|           120 | 6 ms / 120              | 22 ms / 120                 | 145 ms / 120             |
|           240 | 7 ms / 240              | 104 ms / 240                | 6687 ms / 195 (sat.)     |
|           480 | 6 ms / 480              | 5145 ms / 364 (sat.)        | 16088 ms / 221 (sat.)    |

![Figure 1. Achieved versus offered throughput; a curve falling below the diagonal marks
saturation.](../results/charts/sweep-throughput.svg)

### 5.2 RQ2 — Objective detection (MTTD)

Table 4 reports MTTD for two faults under the baseline and metrics modes.

**Table 4. Objective MTTD (time from fault onset to alert).**

| Fault              | Mode     | Detected | Time→pending (s) | Time→firing (s) | Baseline symptom |
| ------------------ | -------- | -------- | ---------------: | --------------: | ---------------- |
| Payment 500 errors | Baseline | no       |                — |               — | 12% error rate   |
| Payment 500 errors | Metrics  | yes      |              9.4 |            70.3 | —                |
| Slow payment       | Baseline | no       |                — |               — | p95 ≈ 1007 ms    |
| Slow payment       | Metrics  | yes      |              9.7 |            72.2 | —                |

The result is a **step change, not a gradient**. Without a metrics pipeline the fault is
real and severe — a 12% error rate or a roughly one-second p95 latency, both confirmed by
the load generator — yet automatically undetectable. Any metrics-bearing mode detects the
anomaly within roughly one scrape interval (≈9 s to pending) and pages within the alert's
configured debounce (≈70 s to firing). Because metrics, logs, and traces share the same
metric-based alerts, they detect equally fast; detection latency is therefore governed by
alert configuration rather than observability depth. The additional value of logs and
traces lies in the _root-cause_ half of debuggability, a human-in-the-loop measurement
deferred to a future operator study.

### 5.3 Secondary — Database indexing at one million rows

On a controlled dataset of one million transactions across one hundred thousand users, we
evaluated seven PostgreSQL index strategies across five query patterns (35 combinations),
each over repeated `EXPLAIN (ANALYZE, BUFFERS)` runs with a bootstrap 95% CI on the p95
query time, accounting correctly for parallel-scan row counts. Indexes that match a query's
leading columns convert million-row sequential scans into roughly sixteen-row index lookups
(e.g. Q1 user-history p95 24.5 ms → 0.11 ms, +99.6%; Q4 20.0 ms → 0.04 ms, +99.8%), while
every index adds insert overhead ranging from +19% (a partial index) to +322% (a
three-column composite); index sizes ranged from 3.9 to 47.4 MiB. A parallel MongoDB
experiment at the same scale enables a careful SQL-versus-NoSQL comparison that leads with
the structural metric (rows/documents examined) rather than methodology-incomparable
latency: for matched queries both engines narrow to comparable work (e.g. 16 rows versus 11
documents; 27,740 versus 27,553). Per the study's anti-goals, no "engine X is faster than
engine Y" claim is made; conclusions are scoped to this dataset, access pattern, and
hardware.

### 5.4 Secondary — Container orchestration

We additionally compared Docker Compose and Docker Swarm on an identical application stack
(startup, scaling, and recovery), with validated Kubernetes manifests, observing the
expected trade-off between Swarm's lower operational overhead and Kubernetes' stronger
scaling and self-healing primitives. Full figures are in the artifact
(`docs/orchestration-comparison.md`).

## 6. Discussion

The headline practical implication is that **the three pillars are not equally priced.**
Metrics are effectively free at the measured load and are simultaneously the pillar that
_enables_ automated detection — an unusually favorable cost/benefit position. Structured
logging, by contrast, is the dominant cost in both CPU and latency, and its synchronous
shipping path is responsible for the worst tail-latency behavior we observed. The batched,
asynchronous OpenTelemetry export demonstrates that carrying _more_ telemetry need not mean
_worse_ tail latency: the export strategy matters at least as much as the volume.

For RQ2, the objective MTTD reframes a frequently hand-waved benefit into a measured one.
The crucial finding is qualitative and robust to hardware: observability converts an
otherwise-undetectable fault into one detected within a bounded, configurable time. This
also clarifies _which_ pillar delivers detection (metrics) versus diagnosis (logs and
traces), a distinction often blurred in practitioner discourse.

## 7. Threats to Validity

**Construct.** MTTD as alert-firing measures _detection_, not _diagnosis_; we do not claim
to measure root-cause time. Overhead is defined relative to a same-binary baseline, which
isolates instrumentation but not the cost of the application logic itself.

**Internal.** Experiments ran on a single machine; despite randomized mode order and
discarded warm-ups, residual ordering and thermal effects may remain, and the design is
blocked (per-mode) rather than fully interleaved per repetition. The high p95 variance in
instrumented modes (CV up to ≈235%) reflects genuine tail-latency instability under load
and widens the latency confidence intervals.

**External.** Results reflect one application, one workload shape, and one hardware
configuration; absolute latency percentages are sensitive to the chosen load point because
the baseline latency is small. The qualitative ordering and the CPU result are the most
transferable conclusions.

**Conclusion.** N = 10 is the minimum for the chosen non-parametric tests; larger N and a
multi-load sweep would tighten intervals. All statistical choices (non-parametric tests,
bootstrap CIs, effect sizes, CI-overlap rule) follow established guidance precisely to avoid
over-claiming on noisy data.

## 8. Conclusion and Future Work

We measured both halves of the observability trade-off on one controlled microservice
testbed. Metrics impose no statistically detectable overhead yet enable detection that is
otherwise impossible; structured logging is the dominant cost and the chief source of
tail-latency instability; and the batched OpenTelemetry pipeline carries the most telemetry
while remaining comparatively smooth. Objective MTTD shows a step change from undetectable
to bounded detection the moment a metrics pipeline is present.

The most valuable next steps are: (i) **per-repetition interleaving** to tighten the
tail-latency intervals; (ii) an **off-host load generator** to remove the co-location
contention that bounds the high-load measurements in the throughput sweep; and (iii) a
**controlled operator study** to measure the root-cause half of RQ2 (how much logs and
traces reduce time-to-diagnosis).

## Data Availability

All source code, experiment harnesses, raw and processed data, and figures are available at
https://github.com/mhmdevan/TraceForge and archived at
[10.5281/zenodo.20561281](https://doi.org/10.5281/zenodo.20561281). Code is licensed under
the MIT License; experimental data and figures under CC-BY-4.0. Every result is regenerable
from source per the reproduction guide (`docs/reproducibility.md`).

## References

1. Sigelman, B. H., et al. (2010). _Dapper, a Large-Scale Distributed Systems Tracing Infrastructure._ Google Technical Report.
2. Mace, J., Roelke, R., & Fonseca, R. (2015). _Pivot Tracing: Dynamic Causal Monitoring for Distributed Systems._ SOSP.
3. Kaldor, J., et al. (2017). _Canopy: An End-to-End Performance Tracing and Analysis System._ SOSP.
4. _Enjoy your observability: an industrial survey of microservice tracing and analysis._ Empirical Software Engineering (2022).
5. _A Survey on Observability of Distributed Edge & Container-Based Microservices_ (2022).
6. He, S., et al. (2021). _A Survey on Automated Log Analysis for Reliability Engineering._ ACM Computing Surveys.
7. Georges, A., Buytaert, D., & Eeckhout, L. (2007). _Statistically Rigorous Java Performance Evaluation._ OOPSLA.
8. Kalibera, T., & Jones, R. (2013). _Rigorous Benchmarking in Reasonable Time._ ISMM.
9. Arcuri, A., & Briand, L. (2014). _A Hitchhiker's Guide to Statistical Tests for Assessing Randomized Algorithms in Software Engineering._ STVR.
10. Mann, H. B., & Whitney, D. R. (1947). _On a Test of Whether One of Two Random Variables is Stochastically Larger than the Other._ Annals of Mathematical Statistics.
11. Kruskal, W. H., & Wallis, W. A. (1952). _Use of Ranks in One-Criterion Variance Analysis._ JASA.
12. Cliff, N. (1993). _Dominance Statistics: Ordinal Analyses to Answer Ordinal Questions._ Psychological Bulletin.
13. Vargha, A., & Delaney, H. D. (2000). _A Critique and Improvement of the CL Common Language Effect Size Statistics of McGraw and Wong._ Journal of Educational and Behavioral Statistics.
14. Efron, B., & Tibshirani, R. J. (1993). _An Introduction to the Bootstrap._ Chapman & Hall.
15. Basiri, A., et al. (2016). _Chaos Engineering._ IEEE Software.
16. OpenTelemetry, CNCF — https://opentelemetry.io/docs/ ; W3C Trace Context Recommendation (2020) — https://www.w3.org/TR/trace-context/.

> The full annotated reference list, including the OpenTelemetry-overhead studies and the
> effect-size confidence-interval literature, is in `docs/related-work.md`. Verify all
> entries against their primary sources before submission.
