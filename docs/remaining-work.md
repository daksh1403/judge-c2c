# Current remaining work

Affected workstream bookkeeping; requirements and acceptance criteria are unchanged.

| Status         | Items |
| -------------- | ----: |
| PASS           |   636 |
| BLOCKED        |     2 |
| PARTIAL        |    74 |
| NOT_APPLICABLE |     2 |

Original calibration is resolved, current policy-v10 three-submission replay is recorded. Production remains unauthorized.

## 01. Project foundation & development workflow

- **01.03 — Production deployment verified (BLOCKED)**: Production deployment verified: Production deploy is deliberately disabled and production resources have not been provisioned; no approved main merge was tested.
- **01.04 — Main is production branch (PARTIAL)**: Main is production branch: Workflow configuration was inspected; governance and clean independent setup require separate operational proof.
- **01.05 — No normal feature work on main (PARTIAL)**: No normal feature work on main: Workflow configuration was inspected; governance and clean independent setup require separate operational proof.
- **01.12 — Local preview production separation (PARTIAL)**: Local preview production separation: Workflow configuration was inspected; governance and clean independent setup require separate operational proof.
- **01.13 — No committed secrets (PARTIAL)**: No committed secrets: Recognized credentials are redacted and local secret files ignored; exhaustive Git history and arbitrary-secret scanning are not proven.

## 02. Cloudflare PR Preview workflow

- **02.06 — Preview production separation (PARTIAL)**: Preview production separation: Review resources are separated by configuration; no production runtime or complete production-data isolation test exists.
- **02.07 — No production data copied (PARTIAL)**: No production data copied: Review resources are separated by configuration; no production runtime or complete production-data isolation test exists.
- **02.08 — No production secrets exposed (PARTIAL)**: No production secrets exposed: Review resources are separated by configuration; no production runtime or complete production-data isolation test exists.
- **02.11 — Approved main merge deploys production (BLOCKED)**: Approved main merge deploys production: Production remains disabled; preview success cannot prove a production merge deploy.

## 03. GitHub integration

- **03.01 — GitHub App production credentials (PARTIAL)**: GitHub App production credentials: Review App works with downscoped minted credentials; production credentials absent and installation-level extra permissions remain an owner cleanup.
- **03.03 — Least privilege (PARTIAL)**: Least privilege: Review App works with downscoped minted credentials; production credentials absent and installation-level extra permissions remain an owner cleanup.

## 17. Evaluation Contract

- **17.13 — Security requirements (PARTIAL)**: Security requirements: These expectations can be expressed as criteria/trusted checks; category-specific policy schemas and comprehensive scanner/benchmark profiles remain incomplete.

## 18. Baseline system

- **18.08 — Pre-existing vulnerabilities (PARTIAL)**: Pre-existing vulnerabilities: Bounded source patterns and declared npm advisory comparisons distinguish deltas; exploitability and comprehensive vulnerability analysis are not proven.
- **18.09 — New vulnerabilities (PARTIAL)**: New vulnerabilities: Bounded source patterns and declared npm advisory comparisons distinguish deltas; exploitability and comprehensive vulnerability analysis are not proven.
- **18.12 — Credit attributable to diff (PARTIAL)**: Credit attributable to diff: No automatic additional credit exists; reviewed completion is evidence-gated, but functional extra-contribution attribution is incomplete.

## 20. Deterministic evaluation

- **20.10 — Security scans (PARTIAL)**: Security scans: Bounded source patterns and exact npm OSV fixture normalization exist; live OSV timed out and full scanners remain absent.
- **20.11 — Dependency audit (PARTIAL)**: Dependency audit: Bounded source patterns and exact npm OSV fixture normalization exist; live OSV timed out and full scanners remain absent.

## 22. Secure execution environment

- **22.02 — Isolation architecture (PARTIAL)**: Isolation architecture: Deliberate Docker VM isolation is implemented for development; suitable production hostile-code capacity remains unprovisioned.
- **22.18 — Redaction (PARTIAL)**: Redaction: Known credential formats are redacted; arbitrary secret recognition and binary artifact scanning are not exhaustive.

## 23. Malicious-code protection

- **23.13 — Prompt injection (PARTIAL)**: Prompt injection: Hostile README and forged AI outputs did not override objective statuses; semantic narrative accuracy still fails calibration in some claims.

## 25. PR solution approach review

- **25.01 — Observable problem (PARTIAL)**: Observable problem: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.02 — Observable approach (PARTIAL)**: Observable approach: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.03 — Changed components (PARTIAL)**: Changed components: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.04 — Root problem (PARTIAL)**: Root problem: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.05 — Symptom masking (PARTIAL)**: Symptom masking: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.06 — Unnecessary complexity (PARTIAL)**: Unnecessary complexity: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.07 — Duplication (PARTIAL)**: Duplication: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.08 — Architecture fit (PARTIAL)**: Architecture fit: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.09 — Tradeoffs (PARTIAL)**: Tradeoffs: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.10 — Assumptions (PARTIAL)**: Assumptions: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.11 — Edge cases (PARTIAL)**: Edge cases: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.12 — Maintainability (PARTIAL)**: Maintainability: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.13 — Scalability (PARTIAL)**: Scalability: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.14 — Security risk (PARTIAL)**: Security risk: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.

## 27. Code-quality review

- **27.01 — Maintainability (PARTIAL)**: Maintainability: General evidence-cited AI findings can discuss this dimension; no dimension-specific deterministic analyzer or comprehensive semantic calibration proves reliable judgments.
- **27.02 — Separation of concerns (PARTIAL)**: Separation of concerns: General evidence-cited AI findings can discuss this dimension; no dimension-specific deterministic analyzer or comprehensive semantic calibration proves reliable judgments.
- **27.03 — Duplication (PARTIAL)**: Duplication: General evidence-cited AI findings can discuss this dimension; no dimension-specific deterministic analyzer or comprehensive semantic calibration proves reliable judgments.
- **27.04 — Error handling (PARTIAL)**: Error handling: General evidence-cited AI findings can discuss this dimension; no dimension-specific deterministic analyzer or comprehensive semantic calibration proves reliable judgments.
- **27.05 — Naming (PARTIAL)**: Naming: General evidence-cited AI findings can discuss this dimension; no dimension-specific deterministic analyzer or comprehensive semantic calibration proves reliable judgments.
- **27.06 — Structure (PARTIAL)**: Structure: General evidence-cited AI findings can discuss this dimension; no dimension-specific deterministic analyzer or comprehensive semantic calibration proves reliable judgments.
- **27.07 — Complexity (PARTIAL)**: Complexity: General evidence-cited AI findings can discuss this dimension; no dimension-specific deterministic analyzer or comprehensive semantic calibration proves reliable judgments.
- **27.08 — API design (PARTIAL)**: API design: General evidence-cited AI findings can discuss this dimension; no dimension-specific deterministic analyzer or comprehensive semantic calibration proves reliable judgments.
- **27.09 — Architectural consistency (PARTIAL)**: Architectural consistency: General evidence-cited AI findings can discuss this dimension; no dimension-specific deterministic analyzer or comprehensive semantic calibration proves reliable judgments.
- **27.10 — Technical debt (PARTIAL)**: Technical debt: General evidence-cited AI findings can discuss this dimension; no dimension-specific deterministic analyzer or comprehensive semantic calibration proves reliable judgments.
- **27.11 — Testability (PARTIAL)**: Testability: General evidence-cited AI findings can discuss this dimension; no dimension-specific deterministic analyzer or comprehensive semantic calibration proves reliable judgments.

## 28. Security review

- **28.01 — Hardcoded secrets (PARTIAL)**: Hardcoded secrets: Source/advisory signals and general AI context exist; comprehensive security scanning and confirmed exploitability review are not implemented.
- **28.02 — Input validation (PARTIAL)**: Input validation: Source/advisory signals and general AI context exist; comprehensive security scanning and confirmed exploitability review are not implemented.
- **28.03 — Authentication regression (PARTIAL)**: Authentication regression: Source/advisory signals and general AI context exist; comprehensive security scanning and confirmed exploitability review are not implemented.
- **28.04 — Authorization regression (PARTIAL)**: Authorization regression: Source/advisory signals and general AI context exist; comprehensive security scanning and confirmed exploitability review are not implemented.
- **28.05 — Injection (PARTIAL)**: Injection: Source/advisory signals and general AI context exist; comprehensive security scanning and confirmed exploitability review are not implemented.
- **28.06 — Sensitive data (PARTIAL)**: Sensitive data: Source/advisory signals and general AI context exist; comprehensive security scanning and confirmed exploitability review are not implemented.
- **28.07 — Dependencies (PARTIAL)**: Dependencies: Source/advisory signals and general AI context exist; comprehensive security scanning and confirmed exploitability review are not implemented.
- **28.08 — Command execution (PARTIAL)**: Command execution: Source/advisory signals and general AI context exist; comprehensive security scanning and confirmed exploitability review are not implemented.
- **28.09 — File handling (PARTIAL)**: File handling: Source/advisory signals and general AI context exist; comprehensive security scanning and confirmed exploitability review are not implemented.
- **28.10 — Permission bypass (PARTIAL)**: Permission bypass: Source/advisory signals and general AI context exist; comprehensive security scanning and confirmed exploitability review are not implemented.
- **28.11 — Network behavior (PARTIAL)**: Network behavior: Source/advisory signals and general AI context exist; comprehensive security scanning and confirmed exploitability review are not implemented.

## 29. Architecture review

- **29.01 — Consistency (PARTIAL)**: Consistency: Architecture-fit observations are structured and cited; complete architectural context, dependency graphs and trustworthy semantic calibration remain incomplete.
- **29.02 — Boundaries (PARTIAL)**: Boundaries: Architecture-fit observations are structured and cited; complete architectural context, dependency graphs and trustworthy semantic calibration remain incomplete.
- **29.03 — Coupling (PARTIAL)**: Coupling: Architecture-fit observations are structured and cited; complete architectural context, dependency graphs and trustworthy semantic calibration remain incomplete.
- **29.04 — Cohesion (PARTIAL)**: Cohesion: Architecture-fit observations are structured and cited; complete architectural context, dependency graphs and trustworthy semantic calibration remain incomplete.
- **29.05 — Data flow (PARTIAL)**: Data flow: Architecture-fit observations are structured and cited; complete architectural context, dependency graphs and trustworthy semantic calibration remain incomplete.
- **29.06 — Scalability (PARTIAL)**: Scalability: Architecture-fit observations are structured and cited; complete architectural context, dependency graphs and trustworthy semantic calibration remain incomplete.
- **29.07 — Extensibility (PARTIAL)**: Extensibility: Architecture-fit observations are structured and cited; complete architectural context, dependency graphs and trustworthy semantic calibration remain incomplete.
- **29.08 — Unnecessary rewrite (PARTIAL)**: Unnecessary rewrite: Architecture-fit observations are structured and cited; complete architectural context, dependency graphs and trustworthy semantic calibration remain incomplete.
- **29.09 — Layer bypass (PARTIAL)**: Layer bypass: Architecture-fit observations are structured and cited; complete architectural context, dependency graphs and trustworthy semantic calibration remain incomplete.
- **29.10 — Responsibility placement (PARTIAL)**: Responsibility placement: Architecture-fit observations are structured and cited; complete architectural context, dependency graphs and trustworthy semantic calibration remain incomplete.

## 34. Prompt-injection protection

- **34.01 — README hostile (PARTIAL)**: README hostile: Policy treats participant text/logs as hostile and provides no privileged tools; tested objective invariants hold, but this is not exhaustive semantic injection containment.
- **34.02 — Comments hostile (PARTIAL)**: Comments hostile: Policy treats participant text/logs as hostile and provides no privileged tools; tested objective invariants hold, but this is not exhaustive semantic injection containment.
- **34.03 — Issue body hostile (PARTIAL)**: Issue body hostile: Policy treats participant text/logs as hostile and provides no privileged tools; tested objective invariants hold, but this is not exhaustive semantic injection containment.
- **34.04 — Test output hostile (PARTIAL)**: Test output hostile: Policy treats participant text/logs as hostile and provides no privileged tools; tested objective invariants hold, but this is not exhaustive semantic injection containment.
- **34.05 — Logs hostile (PARTIAL)**: Logs hostile: Policy treats participant text/logs as hostile and provides no privileged tools; tested objective invariants hold, but this is not exhaustive semantic injection containment.
- **34.09 — Context redaction (PARTIAL)**: Context redaction: Known credentials are redacted from stored/model context; unknown secret formats require stronger scanners.

## 36. Async processing queueing

- **36.10 — Horizontal capacity (PARTIAL)**: Horizontal capacity: Latest queued work is ordered first and obsolete work stops at stage boundaries; active provider calls are not force-cancelled and multi-host event-scale capacity is unverified.

## 37. Efficiency improvements

- **37.08 — Warm capacity decision (PARTIAL)**: Warm capacity decision: Development runner stays available but each job gets fresh guests; production warm capacity has not been provisioned.

## 45. Persistent data model

- **45.01 — Organizations (PARTIAL)**: Organizations: Single configured organization, bounded artifacts/AI traces and per-run baseline evidence exist; multi-event organization models, full traces/object storage and reusable baseline records remain incomplete.

## 51. MVP readiness

- **51.14 — Safe objective execution (PARTIAL)**: Safe objective execution: Development isolation and actual structured model review run; production capacity and accurate prose calibration remain release gates.
