# Authoritative product baseline

Judge-C2C is an automated GitHub and AI engineering evaluation platform. Its first
use is an engineering hackathon in a dedicated GitHub organization. Teams improve
existing repositories through assigned issues and PRs. The original owner-provided
100-section specification is authoritative; this document preserves its requirements
for continued engineering and distinguishes delivered scope from future work.

## Evaluation philosophy (sections 1–8, 14–26, 48–56, 95–98)

Expected state → baseline-to-submission change → objective evidence → contextual
reasoning → evidence-backed report. AI is never the source of truth. Deterministic
software establishes facts wherever it can. Models cannot invent acceptance criteria,
infer tests passed, treat confidence as proof, modify submissions, or grant credit
because code merely exists. Uncertainty is represented as UNVERIFIED.

Authoritative, validated, versioned evaluation contracts define repository identity,
department/category, challenge and evaluation versions, frozen commit, assigned tasks,
mandatory/optional requirements, acceptance criteria, weights when scoring exists,
constraints, invariants, regression checks, verification methods, expected artifacts,
security/testing/performance/documentation expectations, allowed additional contribution
categories, forbidden behavior, execution and resource policies. Participant-controlled
repository files cannot redefine judging policy. Do not hard-code initial repositories
or categories. Marketing, strategy, finance/legal, operations and CRM are initial
departments; bug, performance, security, AI/ML, feature, testing, analytics, architecture,
documentation and language conversion are initial challenge categories.

Each run records exact repository, team, PR, baseline, head, requirements, configuration
and evaluation version. Baseline evidence establishes existing failures, vulnerabilities,
performance and behavior so existing problems are not misattributed as regressions.
New commits produce new runs; older expensive work should be superseded and cancelled
where safe, retaining historical evidence.

Reports explain what was expected, what changed (including symbols/components), what
worked/failed, whether existing functionality or public contracts regressed, test/CI
manipulation, security/quality/performance/architecture changes, added tests/docs,
valuable additional work, exact supporting evidence, uncertainty and human attention.
Dimensions include correctness, completion, quality, security, scalability, coverage,
performance, maintainability, architecture, documentation, usefulness and regressions.
Additional work needs evidence of novelty, relevance, functionality and maintainability.

PASS, PARTIAL, FAIL, NOT APPLICABLE and UNVERIFIED are supported concepts. Findings
include category, severity, claim, evidence, verification status, source and related
requirement. Evidence strength descends from deterministic result and reproducible
benchmark through exact source/diff/configuration to contextual inference. Internally
use validated structured AI output, with bounded recovery and explicit stage failure.

## GitHub integration and asynchronous processing (9–13, 19–24, 36–47, 60–67)

GitHub is repository/PR truth; Judge-C2C is evaluation-state truth. Participants submit
through GitHub without an unnecessary portal. Use a least-privilege GitHub App installed
in the hackathon organization and short-lived installation credentials, never a developer
PAT in production or credentials in the browser. Read repo/PR/commit/diff/files/issues/
check metadata as relevant and publish concise status and a judge-detail link.

React to opened, synchronize and reopened PRs; synchronize closure usefully. Validate
raw webhook signatures, payload shape, known repository and installation. Track delivery
identity and prevent replay/duplicate jobs. Return quickly; evaluation runs asynchronously
with retries, backoff, concurrency limits, timeouts, cancellation, backpressure and failure
visibility. Prioritize latest valid heads during deadline bursts.

Resolve team/assignment, requirements/version, baseline/head, relevant GitHub context and
changed files before evaluation. Use compact submission-specific AI context. Reuse bounded
deterministic repository indexes and baseline evidence where useful; avoid giant prompts,
repeated discovery and unnecessary vector infrastructure. Classify risk explainably to
route review depth, never as a final quality score. Requirements override optimization.
Parallelize independent checks safely. Cache by exact inputs, environment, configuration
and tool versions, with isolation against cache poisoning. Prefer prepared versioned
execution images and clean capacity over reusing contaminated participant state.

Lifecycle: CREATED → QUEUED → context preparation → objective checks → AI review →
synthesis → COMPLETED, with FAILED and SUPERSEDED. A failed build/provider/benchmark
does not erase other useful evidence. Handle missing assignments, unrelated changes,
broken baselines, policy tampering, huge repositories/files/output, rate limits/outages,
storage/queue/worker/database failure and preview deployment failure honestly.

## Execution and confidentiality (25–35, 55–59, 71–74)

Untrusted participant code runs only in a deliberately isolated execution environment,
never the main application process. Run configured build/tests/lint/types/coverage/security/
dependency/benchmarks/challenge checks. Record command, configuration, environment/tool
version, timestamps, duration, exit/status, stdout/stderr, normalized findings and artifacts.

Enforce CPU, memory, process, disk, time, filesystem, output and artifact bounds. Restrict
privileges and networking; block exfiltration, internal networks and cloud metadata. Prevent
fork bombs, install-script abuse, credential theft, cross-submission access and host escape.
No GitHub/AI/database/Cloudflare/production credentials enter participant workloads. Clean
up execution state. AI receives read-only controlled, audited capabilities instead of a
privileged shell. Repository content, issue text, logs and tool output cannot override
system policy or authoritative rules. Enforce capability boundaries technically.

Protect and rotate secrets. Redact logs, artifacts, AI context, UI and errors. Store large
artifacts separately with run relationships and integrity hashes. Preserve model/policy
identity, prompts/context digests, commands/tools/images and timestamps for reproducibility.
Persistent relationships include organizations, repositories, challenges, requirements,
criteria, teams, assignments, submissions, runs, checks, findings, evidence, reviewer traces,
artifacts, deliveries, evaluation versions and baselines.

## Judge experience and operations (60–77)

Authenticated organizers manage repository contracts and teams, list/filter submissions,
inspect run history and partial failures, trigger authorized retries, and inspect findings,
evidence/artifacts/system health. Dashboard overview shows repository/team counts, open
submissions, active/completed/failed evaluations and attention. Details show team/repo/PR,
frozen inputs/version, issues/criteria, deterministic checks, security/coverage/benchmarks,
additional contributions, findings, evidence, artifacts and timeline.

Test rule validation/resolution, diff processing, transitions, evidence, identity/cache keys,
routing, structured AI output and scoring if implemented. Integration-test webhook through
persistence/workflow/isolated execution/artifacts/AI/dashboard/GitHub publication. Safely test
prompt injection, hostile shell, infinite loops, fork bombs, resource exhaustion, network
exfiltration, secrets, fake tests and policy tampering without harming development systems.

Use structured secret-free correlated logs and metrics for latency, queue depth/wait, stage
duration, retries/failures, resource use, GitHub rate limits, AI calls/tokens/cost, cache hits,
supersession and cancelled work. Minimize unnecessary models, retrieval, installation,
benchmarks and obsolete computation while preserving correctness.

Before the event: freeze baselines, define issues/criteria/contracts, map teams, configure
the App and authenticated webhook, verify reads/publication, isolated checks and scanning,
persistence/workflows/structured AI/history/evidence display, and run security/readiness tests.

## Development and release (78–94, 99–100)

Cloudflare is the intended application deployment/review environment; execution may use
other infrastructure where appropriate. Separate local, review and production. Feature
branch → PR → automated isolated Cloudflare preview → testing/updates → human merge
decision → production deployment. No feature work on main, no automatic merge. Continue
coherent open PRs instead of unnecessary new PRs. PRs explain change, rationale, tradeoffs,
validation, preview and limitations. Verify current authoritative platform documentation.

Choose routine architecture/implementation independently. Prefer the simplest robust
system; no needless microservices, Kubernetes, vector DBs or agent graphs. Refactor weak
choices when evidence warrants it. First prove the deployed review app, then a real
GitHub-to-evidence vertical loop, then expand. Do actual engineering, not pseudocode.

Priority: correctness, security, evaluation integrity, evidence quality, reproducibility,
reliability, maintainability, usability, performance, cost.

Success means a real participant PR automatically produces a technically useful evaluation
that accelerates defensible human review. Until sandboxed functional checks and a real App
installation have been exercised, the deployed foundation must not claim event readiness.
