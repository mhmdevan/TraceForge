# Related Work

> **Draft for the TraceForge paper.** This section reviews prior work and positions
> the study's contribution. Citations are given in author–year form with a
> reference list below; **verify every entry (authors, venue, year, DOI) against the
> primary source before submission** — preprints and theses in particular should be
> replaced with their final published versions where available.

This work sits at the intersection of four lines of research: (1) microservice
observability and distributed tracing, (2) empirical measurement of instrumentation
overhead, (3) rigorous performance-benchmarking methodology, and (4) the operational
trade-offs of data-store indexing and container orchestration. We review each in turn
and then state the gap this study addresses.

## 1. Microservice observability and the three pillars

Observability in microservice systems is conventionally organized around three
"pillars" — metrics, logs, and traces — which together let operators infer internal
state from external signals (the _Enjoy your observability_ industrial survey, EMSE
2022; the QUB survey on observability of edge and container-based microservices, 2022).
The same surveys report that, in practice, teams adopt a tracing-and-analysis pipeline
with explicit cost/benefit trade-offs, that visualization and simple statistics remain
the dominant analysis techniques, and that correlating signals across services is a
recurring operational pain point. Industry practice has crystallized into lightweight
conventions for _what_ to measure — Google's "four golden signals," Wilkie's RED method
(rate, errors, duration) and Gregg's USE method (utilization, saturation, errors) — but
these prescribe signals, not their cost.

Distributed tracing specifically has a well-established lineage. Google's **Dapper**
(Sigelman et al., 2010) introduced low-overhead, sampling-based, end-to-end tracing at
scale and motivated most subsequent systems. **Pivot Tracing** (Mace et al., 2015) added
dynamic, causally-aware instrumentation, and **Canopy** (Kaldor et al., 2017) generalized
trace collection into an end-to-end performance-analysis platform. **OpenTelemetry**
(CNCF) and the **W3C Trace Context** recommendation (2020) have since standardized signal
generation and propagation across vendors — the stack this study instruments.

## 2. The cost of observability: instrumentation overhead

The premise that observability is "cheap" is widely assumed but unevenly measured.
Recent empirical studies of **OpenTelemetry** report that, under realistic load and with
reasonable configuration, CPU overhead is typically in the low single-digit percentages
and is sensitive to language/runtime and to manual-vs-automatic instrumentation (an Umeå
University thesis evaluating OTel's impact on microservices, 2024; a comparative
benchmarking study of OpenTelemetry against commercial solutions, 2024; a study of
performance overhead and optimization strategies in OpenTelemetry, preprint 2024).
Monitoring-overhead measurement also has a methodological lineage in the Kieker/MooBench
line of microbenchmarks, recently revisited for cloud profilers (the Cloudprofiler +
MooBench evaluation, arXiv 2024). On the logging side, a survey of automated log analysis
for reliability engineering (He et al., 2021) catalogues the downstream value of logs but
also their volume and processing cost.

Two observations motivate the present study. First, most overhead studies isolate a
**single pillar** (most often tracing) or compare a **binary** instrumented-vs-not
condition, or compare OTel against a _commercial_ alternative; few measure the
**incremental** cost of _progressively deeper_ observability on the _same_ system against
a _true uninstrumented baseline_. Second, the headline overhead figures vary by more than
an order of magnitude across studies, which is largely an artifact of differing load
regimes — a system measured near idle reports very different relative overhead from one
measured in steady state. This makes a controlled, mode-by-mode design with an explicit
load model essential, and connects directly to the methodology literature below.

## 3. Benchmarking methodology and statistical rigor

A consistent finding across the systems and empirical-software-engineering communities is
that performance evaluations are frequently under-powered and under-reported. Georges et
al. (2007) showed that naïve "best-of-N" or single-run summaries of Java performance are
misleading and argued for confidence-interval–based comparison; Kalibera and Jones (2013)
formalized how many repetitions are actually needed and how to budget them. More recently,
analyses of published results report that a majority of performance papers omit confidence
intervals entirely and that many observed "improvements" fall within measurement noise
(effect-size confidence-interval methods, arXiv 2020; "don't forget the difference and the
confidence interval," arXiv 2022).

Because latency distributions are heavy-tailed and non-normal, the appropriate tools are
non-parametric. Arcuri and Briand (2014) provide the canonical software-engineering
guidance: report **median and dispersion**, test with the **Mann–Whitney U** test
(Mann & Whitney, 1947) and its k-group generalization **Kruskal–Wallis** (Kruskal &
Wallis, 1952), and accompany every p-value with a standardized **effect size** —
Cliff's delta (Cliff, 1993) or the Vargha–Delaney A₁₂ statistic (Vargha & Delaney, 2000).
Bootstrap resampling (Efron & Tibshirani, 1993) yields distribution-free confidence
intervals for medians. This study adopts exactly this apparatus — open-model
(constant-arrival-rate) load, warm-up exclusion, N ≥ 10 repetitions in randomized order,
bootstrap 95% CIs, Mann–Whitney/Kruskal–Wallis tests, Cliff's delta, and a
CI-overlap decision rule — precisely to avoid the pitfalls the methodology literature
documents.

## 4. Data-store indexing in service architectures

Index design is a classical database topic, but its effect is usually reported at the
_query-execution_ level rather than at the _service_ level under concurrent load. The
read-improvement-versus-write-penalty trade-off and the behaviour of single-column,
composite, and partial indexes are well documented for relational engines (e.g., the
PostgreSQL documentation), and document stores expose analogous compound and partial
indexes (the MongoDB documentation). Comparative SQL-versus-NoSQL evaluations exist, but
careful, scope-limited comparisons that hold the dataset, access pattern, and hardware
fixed — and that compare engines on the _structural_ work performed (rows/documents
examined) rather than on raw, methodology-incomparable latency — remain relatively scarce.
This study contributes such a comparison as a secondary result.

## 5. Container orchestration trade-offs

The operational differences between Docker Compose, Docker Swarm, and Kubernetes are
extensively discussed in practitioner literature: Swarm offers a simpler manager/worker
model with lower overhead that suits smaller deployments, whereas Kubernetes provides
stronger scaling, self-healing, and scheduling primitives at the cost of substantially
more configuration and control-plane overhead (e.g., the CircleCI, Portainer, and Dash0
comparisons; official Docker and Kubernetes documentation). Peer-reviewed, controlled
comparisons that measure startup, scaling, and recovery on an identical application stack
are comparatively rare, which is part of why this study includes a small, measured
Compose-versus-Swarm comparison (with validated Kubernetes manifests) as a third,
secondary contribution.

## 6. Failure injection and debuggability

Deliberately injecting faults to study system behaviour is the basis of **chaos
engineering** (Basiri et al., 2016). Most of this literature, and the observability
surveys above, treat the _debuggability_ benefit of telemetry qualitatively — telemetry is
assumed to speed diagnosis — while the survey on automated log analysis (He et al., 2021)
focuses on automated rather than human-in-the-loop diagnosis. Quantifying how much each
observability layer reduces human time-to-detect and time-to-root-cause, under a fixed
protocol, remains comparatively under-explored; this study implements the fault-injection
mechanisms and a measurement protocol for it, and is explicit that the human timings
themselves require a controlled operator study.

## 7. Research gap and contribution

Against this body of work, the distinctive contribution of this study is a single,
reproducible testbed that:

1. Measures the **incremental** overhead of _progressively_ deeper observability — none →
   metrics → +logs → +traces → +full OpenTelemetry collector pipeline — on one
   transaction-processing microservice system against a **true uninstrumented baseline**,
   accounting jointly for latency, CPU, memory, and **telemetry volume**;
2. Does so with **statistical rigor** appropriate to non-normal performance data
   (open-model load, N ≥ 10 randomized repetitions, bootstrap CIs, non-parametric tests,
   effect sizes), addressing the under-reporting documented in §3; and
3. Packages overhead, database-indexing, and orchestration comparisons as a **single,
   one-command, version-pinned reproducibility artifact**, with all raw and processed data
   and figures regenerable from source.

To our knowledge, the combination of an incremental, baseline-anchored observability-cost
model with this level of statistical rigor and reproducibility, in one artifact, is not
covered by existing work.

## References

1. Sigelman, B. H., et al. (2010). _Dapper, a Large-Scale Distributed Systems Tracing Infrastructure._ Google Technical Report.
2. Mace, J., Roelke, R., & Fonseca, R. (2015). _Pivot Tracing: Dynamic Causal Monitoring for Distributed Systems._ SOSP.
3. Kaldor, J., et al. (2017). _Canopy: An End-to-End Performance Tracing and Analysis System._ SOSP.
4. _Enjoy your observability: an industrial survey of microservice tracing and analysis._ Empirical Software Engineering (2022). https://dl.acm.org/doi/10.1007/s10664-021-10063-9
5. _A Survey on Observability of Distributed Edge & Container-Based Microservices_ (2022). https://pureadmin.qub.ac.uk/ws/portalfiles/portal/577257166/A_Survey_on_Observability_of_Distributed_Edge_amp_Container-Based_Microservices.pdf
6. He, S., et al. (2021). _A Survey on Automated Log Analysis for Reliability Engineering._ ACM Computing Surveys.
7. _Evaluating OpenTelemetry's Impact on Performance in Microservice Architectures._ Umeå University master's thesis (2024). https://umu.diva-portal.org/smash/get/diva2:1877027/FULLTEXT01.pdf
8. _Performance Analysis and Benchmarking of Cloud-Native Observability Frameworks: A Comparative Study of OpenTelemetry and Commercial Solutions_ (2024). https://www.researchgate.net/publication/397763083
9. _Performance Overhead and Optimization Strategies in OpenTelemetry._ Preprint, TechRxiv (2024). https://www.techrxiv.org/users/937157/articles/1334227
10. _Evaluating the Overhead of the Performance Profiler Cloudprofiler with MooBench._ arXiv:2411.17413 (2024). https://arxiv.org/abs/2411.17413
11. Georges, A., Buytaert, D., & Eeckhout, L. (2007). _Statistically Rigorous Java Performance Evaluation._ OOPSLA.
12. Kalibera, T., & Jones, R. (2013). _Rigorous Benchmarking in Reasonable Time._ ISMM.
13. Arcuri, A., & Briand, L. (2014). _A Hitchhiker's Guide to Statistical Tests for Assessing Randomized Algorithms in Software Engineering._ Software Testing, Verification and Reliability (STVR).
14. _Quantifying Performance Changes with Effect Size Confidence Intervals._ arXiv:2007.10899 (2020). https://arxiv.org/abs/2007.10899
15. _Please, Don't Forget the Difference and the Confidence Interval when Seeking for the State-of-the-Art Status._ arXiv:2205.11134 (2022). https://arxiv.org/abs/2205.11134
16. Mann, H. B., & Whitney, D. R. (1947). _On a Test of Whether One of Two Random Variables is Stochastically Larger than the Other._ Annals of Mathematical Statistics.
17. Kruskal, W. H., & Wallis, W. A. (1952). _Use of Ranks in One-Criterion Variance Analysis._ Journal of the American Statistical Association.
18. Cliff, N. (1993). _Dominance Statistics: Ordinal Analyses to Answer Ordinal Questions._ Psychological Bulletin.
19. Vargha, A., & Delaney, H. D. (2000). _A Critique and Improvement of the CL Common Language Effect Size Statistics of McGraw and Wong._ Journal of Educational and Behavioral Statistics.
20. Efron, B., & Tibshirani, R. J. (1993). _An Introduction to the Bootstrap._ Chapman & Hall.
21. Basiri, A., et al. (2016). _Chaos Engineering._ IEEE Software.
22. OpenTelemetry, CNCF. https://opentelemetry.io/docs/ · W3C Trace Context Recommendation (2020). https://www.w3.org/TR/trace-context/
23. PostgreSQL Global Development Group. _PostgreSQL Documentation — Indexes._ https://www.postgresql.org/docs/ · MongoDB Inc. _MongoDB Manual — Indexes._ https://www.mongodb.com/docs/
