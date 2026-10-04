# Current remaining work

Generated from the current acceptance ledger after focused implementation and executed workstream validation. This report does not repeat a code audit or certify production operation.

| Status          | Items |
| --------------- | ----: |
| PASS            |   536 |
| PARTIAL         |   173 |
| NOT_IMPLEMENTED |     0 |
| UNVERIFIED      |     0 |
| FAIL            |     1 |
| BLOCKED         |     2 |
| NOT_APPLICABLE  |     2 |

PR #6 continues on `feat/evaluation-completeness`. GitHub authentication, native CI and Cloudflare access work; the earlier access blockers are obsolete. No merge is authorized.

The original grounding defect remains FAIL until the original reference, partial and protected-test scenarios pass the revised evidence/AI boundary. CallMissed returned budget-exceeded; Cloudflare output remains subject to citation/contradiction validation and explicit missing-analysis flags. Real OSV reads timed out twice; controlled failure/recovery is verified, live successful scanning is not.

## Remaining acceptance entries

### 01. Project foundation & development workflow

- **01.03 — Production deployment verified (BLOCKED)**: Production deployment verified: Production deploy is deliberately disabled and production resources have not been provisioned; no approved main merge was tested.
- **01.04 — Main is production branch (PARTIAL)**: Main is production branch: Workflow configuration was inspected; governance and clean independent setup require separate operational proof.
- **01.05 — No normal feature work on main (PARTIAL)**: No normal feature work on main: Workflow configuration was inspected; governance and clean independent setup require separate operational proof.
- **01.12 — Local preview production separation (PARTIAL)**: Local preview production separation: Workflow configuration was inspected; governance and clean independent setup require separate operational proof.
- **01.13 — No committed secrets (PARTIAL)**: No committed secrets: Recognized credentials are redacted and local secret files ignored; exhaustive Git history and arbitrary-secret scanning are not proven.
- **01.14 — Reproducible engineer setup (PARTIAL)**: Reproducible engineer setup: Workflow configuration was inspected; governance and clean independent setup require separate operational proof.

### 02. Cloudflare PR Preview workflow

- **02.06 — Preview production separation (PARTIAL)**: Preview production separation: Review resources are separated by configuration; no production runtime or complete production-data isolation test exists.
- **02.07 — No production data copied (PARTIAL)**: No production data copied: Review resources are separated by configuration; no production runtime or complete production-data isolation test exists.
- **02.08 — No production secrets exposed (PARTIAL)**: No production secrets exposed: Review resources are separated by configuration; no production runtime or complete production-data isolation test exists.
- **02.11 — Approved main merge deploys production (BLOCKED)**: Approved main merge deploys production: Production remains disabled; preview success cannot prove a production merge deploy.

### 03. GitHub integration

- **03.01 — GitHub App production credentials (PARTIAL)**: GitHub App production credentials: Review App works with downscoped minted credentials; production credentials absent and installation-level extra permissions remain an owner cleanup.
- **03.03 — Least privilege (PARTIAL)**: Least privilege: Review App works with downscoped minted credentials; production credentials absent and installation-level extra permissions remain an owner cleanup.

### 04. GitHub webhook system

- **04.06 — Issue edited (PARTIAL)**: Issue edited: Supported events are routed through a signed durable inbox; every event/action ordering has not been independently exercised.
- **04.08 — Issue assigned and unassigned (PARTIAL)**: Issue assigned and unassigned: Supported events are routed through a signed durable inbox; every event/action ordering has not been independently exercised.

### 07. GitHub Issues management

- **07.03 — Mandatory optional bonus and non-scored scopes (PARTIAL)**: Mandatory optional bonus and non-scored scopes: All four evaluation scopes are validated in schema; only mandatory and non-scored scopes have real payment challenge evidence.

### 09. Issue quality & moderation

- **09.01 — Bug template (PARTIAL)**: Bug template: Structured templates are supplied for Judge-C2C; they have not been deployed and tested in every challenge repository.
- **09.02 — Feature template (PARTIAL)**: Feature template: Structured templates are supplied for Judge-C2C; they have not been deployed and tested in every challenge repository.
- **09.04 — Performance template (PARTIAL)**: Performance template: Structured templates are supplied for Judge-C2C; they have not been deployed and tested in every challenge repository.
- **09.05 — Clarification workflow (PARTIAL)**: Clarification workflow: Structured templates are supplied for Judge-C2C; they have not been deployed and tested in every challenge repository.
- **09.10 — Spam limits (PARTIAL)**: Spam limits: Repeated reports receive a reversible possible-spam moderation flag and no automatic credit; this is not account-wide throttling or semantic gaming detection.
- **09.11 — Gaming controls (PARTIAL)**: Gaming controls: Repeated reports receive a reversible possible-spam moderation flag and no automatic credit; this is not account-wide throttling or semantic gaming detection.

### 10. Issue assignment & claiming

- **10.06 — Multi-team assignment (PARTIAL)**: Multi-team assignment: Shared capacity and reservations are modeled; expiry is exercised, but all shared-claim and reservation-activation races are not yet covered.
- **10.07 — Reservation when configured (PARTIAL)**: Reservation when configured: Shared capacity and reservations are modeled; expiry is exercised, but all shared-claim and reservation-activation races are not yet covered.

### 11. Issue lifecycle

- **11.06 — In progress (PARTIAL)**: In progress: Native GitHub state, organizer review, assignment progress and run status remain separate; lifecycle projection exists but every transition permutation is not exercised.
- **11.07 — PR opened (PARTIAL)**: PR opened: Native GitHub state, organizer review, assignment progress and run status remain separate; lifecycle projection exists but every transition permutation is not exercised.
- **11.08 — Evaluating (PARTIAL)**: Evaluating: Native GitHub state, organizer review, assignment progress and run status remain separate; lifecycle projection exists but every transition permutation is not exercised.
- **11.10 — Blocked (PARTIAL)**: Blocked: Native GitHub state, organizer review, assignment progress and run status remain separate; lifecycle projection exists but every transition permutation is not exercised.

### 16. Evaluation runs

- **16.08 — Obsolete view warning (PARTIAL)**: Obsolete view warning: Submission history labels CURRENT/Historical; every obsolete deep-link/view race is not independently verified.

### 17. Evaluation Contract

- **17.11 — Regression requirements (PARTIAL)**: Regression requirements: These expectations can be expressed as criteria/trusted checks; category-specific policy schemas and comprehensive scanner/benchmark profiles remain incomplete.
- **17.13 — Security requirements (PARTIAL)**: Security requirements: These expectations can be expressed as criteria/trusted checks; category-specific policy schemas and comprehensive scanner/benchmark profiles remain incomplete.
- **17.14 — Testing requirements (PARTIAL)**: Testing requirements: These expectations can be expressed as criteria/trusted checks; category-specific policy schemas and comprehensive scanner/benchmark profiles remain incomplete.
- **17.15 — Performance requirements (PARTIAL)**: Performance requirements: These expectations can be expressed as criteria/trusted checks; category-specific policy schemas and comprehensive scanner/benchmark profiles remain incomplete.

### 18. Baseline system

- **18.08 — Pre-existing vulnerabilities (PARTIAL)**: Pre-existing vulnerabilities: Bounded source patterns and declared npm advisory comparisons distinguish deltas; exploitability and comprehensive vulnerability analysis are not proven.
- **18.09 — New vulnerabilities (PARTIAL)**: New vulnerabilities: Bounded source patterns and declared npm advisory comparisons distinguish deltas; exploitability and comprehensive vulnerability analysis are not proven.
- **18.12 — Credit attributable to diff (PARTIAL)**: Credit attributable to diff: No automatic additional credit exists; reviewed completion is evidence-gated, but functional extra-contribution attribution is incomplete.

### 19. Baseline precomputation

- **19.01 — Build reuse (PARTIAL)**: Opt-in exact-input execution reuse is implemented with immutable origin provenance and socket-free SQLite verification executed before the no-unit-test instruction. Benchmark reuse is deliberately bypassed. Cloudflare runtime and live baseline reuse remain unverified; this is not a production PASS.
- **19.02 — Test reuse (PARTIAL)**: Opt-in exact-input execution reuse is implemented with immutable origin provenance and socket-free SQLite verification executed before the no-unit-test instruction. Benchmark reuse is deliberately bypassed. Cloudflare runtime and live baseline reuse remain unverified; this is not a production PASS.
- **19.03 — Lint reuse (PARTIAL)**: Opt-in exact-input execution reuse is implemented with immutable origin provenance and socket-free SQLite verification executed before the no-unit-test instruction. Benchmark reuse is deliberately bypassed. Cloudflare runtime and live baseline reuse remain unverified; this is not a production PASS.
- **19.04 — Type-check reuse (PARTIAL)**: Opt-in exact-input execution reuse is implemented with immutable origin provenance and socket-free SQLite verification executed before the no-unit-test instruction. Benchmark reuse is deliberately bypassed. Cloudflare runtime and live baseline reuse remain unverified; this is not a production PASS.
- **19.05 — Security reuse (PARTIAL)**: Opt-in exact-input execution reuse is implemented with immutable origin provenance and socket-free SQLite verification executed before the no-unit-test instruction. Benchmark reuse is deliberately bypassed. Cloudflare runtime and live baseline reuse remain unverified; this is not a production PASS.
- **19.06 — Dependency audit reuse (PARTIAL)**: Opt-in exact-input execution reuse is implemented with immutable origin provenance and socket-free SQLite verification executed before the no-unit-test instruction. Benchmark reuse is deliberately bypassed. Cloudflare runtime and live baseline reuse remain unverified; this is not a production PASS.
- **19.07 — Coverage reuse (PARTIAL)**: Opt-in exact-input execution reuse is implemented with immutable origin provenance and socket-free SQLite verification executed before the no-unit-test instruction. Benchmark reuse is deliberately bypassed. Cloudflare runtime and live baseline reuse remain unverified; this is not a production PASS.

### 20. Deterministic evaluation

- **20.04 — Integration tests (PARTIAL)**: Integration tests: Configurable command kinds retain bounded results; commands depend on tools in the immutable prepared image and cannot themselves establish functional correctness.
- **20.07 — Type check (PARTIAL)**: Type check: Configurable command kinds retain bounded results; commands depend on tools in the immutable prepared image and cannot themselves establish functional correctness.
- **20.08 — Formatting where relevant (PARTIAL)**: Formatting where relevant: Configurable command kinds retain bounded results; commands depend on tools in the immutable prepared image and cannot themselves establish functional correctness.
- **20.09 — Coverage (PARTIAL)**: Coverage: Configurable command kinds retain bounded results; commands depend on tools in the immutable prepared image and cannot themselves establish functional correctness.
- **20.10 — Security scans (PARTIAL)**: Security scans: Bounded source patterns and exact npm OSV fixture normalization exist; live OSV timed out and full scanners remain absent.
- **20.11 — Dependency audit (PARTIAL)**: Dependency audit: Bounded source patterns and exact npm OSV fixture normalization exist; live OSV timed out and full scanners remain absent.

### 22. Secure execution environment

- **22.02 — Isolation architecture (PARTIAL)**: Isolation architecture: Deliberate Docker VM isolation is implemented for development; suitable production hostile-code capacity remains unprovisioned.
- **22.16 — Artifacts (PARTIAL)**: Artifacts: Bounded execution records are available; large retained guest artifacts need account-enabled object storage.
- **22.18 — Redaction (PARTIAL)**: Redaction: Known credential formats are redacted; arbitrary secret recognition and binary artifact scanning are not exhaustive.

### 23. Malicious-code protection

- **23.03 — Memory exhaustion (PARTIAL)**: Memory exhaustion: Memory/disk/network restrictions are configured; full allocation, disk-pressure and malicious dependency-install scenarios are not all independently executed.
- **23.06 — Disk exhaustion (PARTIAL)**: Disk exhaustion: Memory/disk/network restrictions are configured; full allocation, disk-pressure and malicious dependency-install scenarios are not all independently executed.
- **23.07 — Malicious install scripts (PARTIAL)**: Malicious install scripts: Memory/disk/network restrictions are configured; full allocation, disk-pressure and malicious dependency-install scenarios are not all independently executed.
- **23.09 — Internal network probing (PARTIAL)**: Internal network probing: Memory/disk/network restrictions are configured; full allocation, disk-pressure and malicious dependency-install scenarios are not all independently executed.
- **23.13 — Prompt injection (PARTIAL)**: Prompt injection: Hostile README and forged AI outputs did not override objective statuses; semantic narrative accuracy still fails calibration in some claims.

### 25. PR solution approach review

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
- **25.15 — Regression (PARTIAL)**: Regression: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.16 — Objective support (PARTIAL)**: Objective support: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.
- **25.18 — No private intention claims (PARTIAL)**: No private intention claims: Structured approach observations exist, but real partial/manipulated reports included false test-coverage claims; narrative conclusions require judge review.

### 26. Requirement evaluation

- **26.09 — PARTIAL (PARTIAL)**: PARTIAL: PARTIAL is accepted structurally for supported source/contextual assessments; calibrated per-requirement partial aggregation is not implemented.

### 27. Code-quality review

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

### 28. Security review

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

### 29. Architecture review

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

### 30. Additional contribution detection

- **30.01 — Feature (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.02 — Performance (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.03 — Security (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.04 — Tests (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.05 — Analytics (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.06 — Architecture (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.07 — Documentation (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.08 — AI-ML (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.09 — Language conversion (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.10 — Approved other category (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.11 — Introduced in diff (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.12 — Functional verification (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.13 — Relevance (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.14 — Evidence (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.
- **30.15 — Regression safety (PARTIAL)**: Immutable organizer-proposed additional work uses frozen category allowlist, known diff paths/evidence and optional criteria. Verified configured criterion improvement requires objective baseline FAIL to head PASS of proper kind; design/location attribution remains organizer judgment. Atomic audited recognition requires current eligible completed open head without policy failure/regression. Automated discovery and deployed behavior remain unverified.

### 33. Evidence-first findings

- **33.09 — No unsupported claims (FAIL)**: Live CallMissed calibration previously emitted unsupported coverage prose despite valid citation IDs. New source replaces criterion outcomes with objective projections, permits only exact known objective text as OBSERVED, flags contextual narratives and historical reviews for human attention, and prevents conflicting criterion PASS/FAIL evidence from yielding acceptance. The known INFERENCE false-coverage sentence is flagged rather than semantically auto-detected. FAIL remains until the exact real-provider calibration and deployed judge behavior are executed and verified.

### 34. Prompt-injection protection

- **34.01 — README hostile (PARTIAL)**: README hostile: Policy treats participant text/logs as hostile and provides no privileged tools; tested objective invariants hold, but this is not exhaustive semantic injection containment.
- **34.02 — Comments hostile (PARTIAL)**: Comments hostile: Policy treats participant text/logs as hostile and provides no privileged tools; tested objective invariants hold, but this is not exhaustive semantic injection containment.
- **34.03 — Issue body hostile (PARTIAL)**: Issue body hostile: Policy treats participant text/logs as hostile and provides no privileged tools; tested objective invariants hold, but this is not exhaustive semantic injection containment.
- **34.04 — Test output hostile (PARTIAL)**: Test output hostile: Policy treats participant text/logs as hostile and provides no privileged tools; tested objective invariants hold, but this is not exhaustive semantic injection containment.
- **34.05 — Logs hostile (PARTIAL)**: Logs hostile: Policy treats participant text/logs as hostile and provides no privileged tools; tested objective invariants hold, but this is not exhaustive semantic injection containment.
- **34.09 — Context redaction (PARTIAL)**: Context redaction: Known credentials are redacted from stored/model context; unknown secret formats require stronger scanners.

### 36. Async processing queueing

- **36.03 — Backoff (PARTIAL)**: Backoff: Executed idempotency, durable outbox and expiring capacity fixtures retain history, timeout and failure visibility. Independent evidence review: current citations do not execute this exact failure/backoff scenario; configured behavior alone does not prove operational recovery.
- **36.06 — Cancellation (PARTIAL)**: Cancellation: Latest queued work is ordered first and obsolete work stops at stage boundaries; active provider calls are not force-cancelled and multi-host event-scale capacity is unverified.
- **36.08 — Priority (PARTIAL)**: Priority: Latest queued work is ordered first and obsolete work stops at stage boundaries; active provider calls are not force-cancelled and multi-host event-scale capacity is unverified.
- **36.10 — Horizontal capacity (PARTIAL)**: Horizontal capacity: Latest queued work is ordered first and obsolete work stops at stage boundaries; active provider calls are not force-cancelled and multi-host event-scale capacity is unverified.
- **36.11 — Obsolete cancellation (PARTIAL)**: Obsolete cancellation: Latest queued work is ordered first and obsolete work stops at stage boundaries; active provider calls are not force-cancelled and multi-host event-scale capacity is unverified.

### 37. Efficiency improvements

- **37.01 — Content-addressed cache (PARTIAL)**: Content-addressed cache: Credential-free public preview reuses integrity-checked frozen GitHub context; this is not a deterministic execution cache.
- **37.02 — Commit config tool identities (PARTIAL)**: Commit config tool identities: Credential-free public preview reuses integrity-checked frozen GitHub context; this is not a deterministic execution cache.
- **37.03 — Safe reuse (PARTIAL)**: Opt-in exact-input execution reuse is implemented with immutable origin provenance and socket-free SQLite verification executed before the no-unit-test instruction. Benchmark reuse is deliberately bypassed. Cloudflare runtime and live baseline reuse remain unverified; this is not a production PASS.
- **37.06 — Baseline reuse (PARTIAL)**: Opt-in exact-input execution reuse is implemented with immutable origin provenance and socket-free SQLite verification executed before the no-unit-test instruction. Benchmark reuse is deliberately bypassed. Cloudflare runtime and live baseline reuse remain unverified; this is not a production PASS.
- **37.08 — Warm capacity decision (PARTIAL)**: Warm capacity decision: Development runner stays available but each job gets fresh guests; production warm capacity has not been provisioned.

### 38. Deadline burst handling

- **38.02 — Latest priority (PARTIAL)**: Latest priority: Latest-head fencing, bounded recovery, queue counts and a separate serialized AI slot are implemented/tested; high-load latency and capacity are unmeasured.
- **38.03 — Obsolete capacity release (PARTIAL)**: Obsolete capacity release: Latest-head fencing, bounded recovery, queue counts and a separate serialized AI slot are implemented/tested; high-load latency and capacity are unmeasured.
- **38.04 — Backpressure (PARTIAL)**: Backpressure: Latest-head fencing, bounded recovery, queue counts and a separate serialized AI slot are implemented/tested; high-load latency and capacity are unmeasured.
- **38.05 — Queue metrics (PARTIAL)**: Queue metrics: Latest-head fencing, bounded recovery, queue counts and a separate serialized AI slot are implemented/tested; high-load latency and capacity are unmeasured.
- **38.07 — Separate AI capacity when needed (PARTIAL)**: Separate AI capacity when needed: Latest-head fencing, bounded recovery, queue counts and a separate serialized AI slot are implemented/tested; high-load latency and capacity are unmeasured.

### 39. Administrator dashboard

- **39.29 — Additional work (PARTIAL)**: Additional-work records and organizer decisions are now displayed separately, with scoped criterion-improvement verification, evidence links and read-only judge access. Current code has static and independent source review only; deployed UI and live decision flows still require validation.

### 40. Submission sorting filtering

- **40.13 — Latest-time sorting (PARTIAL)**: Validated enum selects oldest/newest with stable repository/PR tie-breakers and judge control; deployed behavior not verified.

### 41. Issue dashboard

- **41.13 — Source filter (PARTIAL)**: Source filter: API issue detail includes assignments/related submissions/evaluation state; UI does not fully render every relationship or filter state.
- **41.14 — Related PR (PARTIAL)**: Related PR: API issue detail includes assignments/related submissions/evaluation state; UI does not fully render every relationship or filter state.
- **41.15 — Evaluation state (PARTIAL)**: Evaluation state: API issue detail includes assignments/related submissions/evaluation state; UI does not fully render every relationship or filter state.

### 45. Persistent data model

- **45.01 — Organizations (PARTIAL)**: Organizations: Single configured organization, bounded artifacts/AI traces and per-run baseline evidence exist; multi-event organization models, full traces/object storage and reusable baseline records remain incomplete.
- **45.16 — Artifacts (PARTIAL)**: Artifacts: Single configured organization, bounded artifacts/AI traces and per-run baseline evidence exist; multi-event organization models, full traces/object storage and reusable baseline records remain incomplete.
- **45.17 — Reviewer traces (PARTIAL)**: Reviewer traces: Single configured organization, bounded artifacts/AI traces and per-run baseline evidence exist; multi-event organization models, full traces/object storage and reusable baseline records remain incomplete.
- **45.20 — Baseline results (PARTIAL)**: Baseline results: Single configured organization, bounded artifacts/AI traces and per-run baseline evidence exist; multi-event organization models, full traces/object storage and reusable baseline records remain incomplete.

### 47. Reproducibility auditability

- **47.11 — Reviewer version (PARTIAL)**: Reviewer version: Runtime/image/evaluator identities and bounded records are retained; full per-tool version catalog and large artifacts are incomplete.

### 48. Observability

- **48.01 — Webhook latency (PARTIAL)**: Both webhook routes record fixed request/error/latency aggregates asynchronously in shared UTC-minute metrics, with a bounded organizer view and seven-day retention. Static checks and local SQLite schema smoke passed; recorded request measurements, export/alerts, outage behavior and live deployment remain unverified or absent.
- **48.02 — GitHub errors (PARTIAL)**: Authenticated GitHub API requests record bounded numeric error/request/latency metrics without secret/request content; organizer-only metric access and maintenance exist. Runtime API failure injection, persistence failure, exports/alerts and deployed visibility are unverified; raw public file fetches are outside this instrumentation.
- **48.03 — GitHub limits (PARTIAL)**: GitHub API metrics identify HTTP429, exhausted primary rate headers and secondary403 Retry-After responses. This does not change retry behavior. Runtime primary/secondary rate-limit scenarios, exports/alerts and live observation remain unverified.
- **48.04 — Queue depth (PARTIAL)**: Queue depth: Current counts, run timestamps and AI usage/duration/retries are recorded; aggregated historical metrics, dashboards and alerts remain incomplete.
- **48.05 — Queue wait (PARTIAL)**: Bounded recent-run timeline intervals with sample counts, unavailable values, truncation disclosure and judge visibility; live timings not verified.
- **48.06 — Evaluation duration (PARTIAL)**: Evaluation duration: Current counts, run timestamps and AI usage/duration/retries are recorded; aggregated historical metrics, dashboards and alerts remain incomplete.
- **48.07 — Stage duration (PARTIAL)**: Bounded recent-run timeline intervals with sample counts, unavailable values, truncation disclosure and judge visibility; live timings not verified.
- **48.14 — AI latency (PARTIAL)**: AI latency: Current counts, run timestamps and AI usage/duration/retries are recorded; aggregated historical metrics, dashboards and alerts remain incomplete.
- **48.15 — AI tokens (PARTIAL)**: AI tokens: Current counts, run timestamps and AI usage/duration/retries are recorded; aggregated historical metrics, dashboards and alerts remain incomplete.
- **48.17 — AI cost (PARTIAL)**: Known organizer-supplied model rates and actual provider token usage produce a scoped successful-final-response USD estimate. Missing rates/usage remain unavailable; retrieval, failed-request and whole-provider invoice accounting are not certified.
- **48.19 — Retries (PARTIAL)**: Retries: Current counts, run timestamps and AI usage/duration/retries are recorded; aggregated historical metrics, dashboards and alerts remain incomplete.
- **48.20 — Superseded count (PARTIAL)**: Superseded count: Current counts, run timestamps and AI usage/duration/retries are recorded; aggregated historical metrics, dashboards and alerts remain incomplete.

### 49. Failure handling

- **49.02 — GitHub outage (PARTIAL)**: GitHub outage: Fixture API limits, dispatch failure and crash/cleanup/lease recovery are exercised; genuine service outages and production recovery drills remain unverified.
- **49.03 — GitHub limits (PARTIAL)**: GitHub limits: Fixture API limits, dispatch failure and crash/cleanup/lease recovery are exercised; genuine service outages and production recovery drills remain unverified.
- **49.11 — Baseline build fail (PARTIAL)**: Baseline build fail: Executed boundary/provider/runner fixtures exercise this failure class and preserve objective/historical state; test scope does not cover every external outage ordering. Independent evidence review: current citations do not execute this exact failure/backoff scenario; configured behavior alone does not prove operational recovery.
- **49.12 — Submission build fail (PARTIAL)**: Submission build fail: Executed boundary/provider/runner fixtures exercise this failure class and preserve objective/historical state; test scope does not cover every external outage ordering. Independent evidence review: current citations do not execute this exact failure/backoff scenario; configured behavior alone does not prove operational recovery.
- **49.15 — Worker crash (PARTIAL)**: Worker crash: Fixture API limits, dispatch failure and crash/cleanup/lease recovery are exercised; genuine service outages and production recovery drills remain unverified.
- **49.20 — Database fail (PARTIAL)**: Database fail: Injected database failure returns 503 without acknowledging or persisting the signed delivery, dispatching work or exposing error details. After restoration the same delivery is accepted once and replay is deduplicated. Mid-workflow and live D1 outage recovery remain untested.
- **49.21 — Queue fail (PARTIAL)**: Queue fail: Fixture API limits, dispatch failure and crash/cleanup/lease recovery are exercised; genuine service outages and production recovery drills remain unverified.

### 50. Testing Judge-C2C

- **50.14 — Cache keys (PARTIAL)**: Cache keys: Frozen preview context integrity/cache identity is tested; execution cache does not exist.

### 51. MVP readiness

- **51.14 — Safe objective execution (PARTIAL)**: Safe objective execution: Development isolation and actual structured model review run; production capacity and accurate prose calibration remain release gates.
- **51.17 — Actual AI review (PARTIAL)**: Actual AI review: Development isolation and actual structured model review run; production capacity and accurate prose calibration remain release gates.
- **51.19 — Approach review (PARTIAL)**: Approach review: Development isolation and actual structured model review run; production capacity and accurate prose calibration remain release gates.
