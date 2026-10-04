# Judge-C2C capabilities and operation

Current implementation snapshot: 2026-10-04. This describes the authenticated organization judging system; the credential-free public preview is a limited separate flow. Refer to the current completion checkpoint for evidence and unresolved gates.

## Capabilities

| Area | Implemented behavior | Practical boundary |
| --- | --- | --- |
| Teams and access | GitHub numeric identities, team registration/import, repository mapping, organizer/judge/security/participant permissions, individual revocable credentials and team-scoped server authorization | Live frontend proof used one actual GitHub account/team, not multiple independent people |
| Issues and assignments | Issue requirements, moderated intake, GitHub event synchronization, claim/assignment transitions, release/expiry/reassignment guards and mapping-conflict attention | Organizer approval and immutable contract requirements govern judging |
| Confidential security | Restricted vulnerability reports, server-side security permissions and protected report/artifact access | Public issue text must not contain confidential details; no universal vulnerability guarantee |
| GitHub PR intake | Signed webhooks, delivery deduplication, repository/installation checks, frozen baseline/head and assignment/contract identity | Wrong team, issue, repository or identity cannot acquire valid evaluation by model judgment |
| PR intelligence | Changed-file and bounded symbol/API inventory, stacked/dependent/alternate/superseding relationships, immutable history | Pragmatic supported-language analysis, not a universal compiler or proof of API compatibility |
| Objective execution | Baseline/head build, test, lint, type, coverage, dependency/security and benchmark checks when configured in the trusted contract/profile | Current runner is the supported Node HTTP profile, with trusted TypeScript image variants; not arbitrary runtimes or automatic checks for every repository |
| Dependency preparation | Lockfile/tool/image identity, offline npm ci in disposable isolation, lifecycle scripts disabled, bounded resources and structured failure evidence | Packages must exist in the trusted immutable image cache; arbitrary online installation is not supported |
| Regressions and manipulation | Baseline comparisons, protected-test/file changes, risk signals, policy failures and independent authoritative acceptance checks | Missing execution remains UNVERIFIED; policy failures and functional statuses are separate |
| AI reviewer | CallMissed or Cloudflare provider, bounded prioritized context and progressive read-only retrieval, schema/citation validation, objective precedence and explicit uncertainty | Latest actual review uses CallMissed kimi-k2.6, policy v14. AI narratives do not establish facts or know participant private reasoning |
| Engineering review | Observable solution approach, correctness, code quality, architecture, security, performance, maintainability and testing dimensions with evidence and human attention | Source heuristics are UNVERIFIED advisory analysis; unsupported factual prose is rejected or downgraded |
| Additional contributions | Shared evidence-backed categories for features, security, tests, performance, architecture, documentation and other approved work; organizer recognition | Suggestions do not award credit without introduced, relevant, functional, regression-safe evidence |
| Judge frontend | Submission summary, requirements, objective checks, approach, engineering review, security/performance, additional work, regressions, attention queue, evidence navigation, history, filters and sorting | Uses existing dashboard; no terminal or raw JSON is required for normal judging |
| Evidence and decisions | Integrity-checked artifacts, protected downloads, immutable failed/superseded attempts, audit history and recorded human decisions | AI cannot waive criteria or issue authoritative credit; humans resolve attention items |
| Efficiency and operations | Exact-input repository/context/baseline/audit caches, change/risk routing, concurrency leases, retries/backoff, supersession, stage/run metrics, token usage and cost where reliably known | Benchmark measurements run fresh; unavailable pricing stays unavailable; two local worker isolates do not certify production event capacity |
| Failure handling | Install/build/scanner/storage/provider/database failures become explicit states, preserve successful evidence and permit controlled retries/new attempts | Infrastructure failure cannot produce participant PASS |

## End-to-end operation

1. Organizer connects a suitably restricted GitHub App, registers teams/repositories and approves issues.
2. Organizer freezes the evaluation contract, required criteria, trusted check profile and baseline, then assigns the issue to a team.
3. A mapped PR is submitted in the frontend or arrives through a verified GitHub event.
4. The backend validates identity/mapping and freezes the PR head, baseline, contract and assignment for a new immutable attempt.
5. Durable workers prepare bounded repository context and execute configured baseline/head checks through the isolated runner. Dependency preparation happens inside that boundary.
6. Objective checks produce criterion-linked evidence, regression/policy findings and structured failures. Superseded work retains history while the latest head remains authoritative.
7. The reviewer receives prioritized bounded evidence and permitted read-only context. It never receives privileged shell execution or participant judging authority.
8. Server validation rejects unknown citations, contradictory statuses, unsupported success and invalid narrative assertions. Only objective evidence can recover missing criterion statuses; missing qualitative analysis remains UNVERIFIED/needs review.
9. The frontend presents requirements and engineering interpretation alongside direct evidence, explicit uncertainty and actionable attention items.
10. A GitHub Check and protected evidence artifacts are published when configured. The judge inspects the frontend and records a human decision.

The TypeScript control plane runs on Cloudflare Workers. Cloudflare Workflows execute durable evaluation stages; D1 stores teams/contracts/assignments/runs/identity/audit state; R2/KV support protected evidence/cache storage. Static HTML/CSS/JavaScript in public/ is served by the existing Worker. The isolated runner is a separate execution boundary, not code execution inside the control plane.

## What is proven now

Actual isolated deployed frontend actions passed the reviewer diagnostic, original reference/partial/protected-test AI calibration, evidence navigation and real registered participant access/revocation. All three AI attempts completed and published checks; no unknown citations or unsupported OBSERVED claims survived, and protected-test manipulation retained FAIL. All 29 current browser tests passed. Bounded local multi-worker capacity/recovery checks passed.

Production configuration, resources, domain, credentials and owner App grants still need setup/verification. Multiple independently isolated organizations/events and deployed event-scale capacity are not certified. The credential-free public preview can fail on GitHub rate limits and does not provide the full authenticated execution/AI workflow.

## Moving to another repository

Transfer the current tested combined feature-branch snapshot, including src/, public/, runner/, migrations/, scripts/, tests/, examples/, .github/, package.json/package-lock.json, TypeScript/Playwright/Vitest/Wrangler configuration, documentation and placeholder secret examples. Preserve tests and immutable acceptance/evidence records rather than copying only the UI or one PR's files.

Do not transfer node_modules, .wrangler runtime state, .dev.vars, .env files, private keys, access codes, runner tunnel keys, database exports, browser sessions or local logs. Fresh installation uses npm ci; run npm run check and npm run test:browser in the destination.

The checked-in wrangler.jsonc currently names the existing review resources. A new deployment must configure its own Worker/Workflow names, exact frontend origins, independent DB/ORG_DB/artifact resources, GitHub App/webhook and runner/AI secrets. The existing deployed review credentials/data must not be silently reused. Apply migrations to both databases. Native Workers Builds integration and GitHub environments/secrets are external settings and must be connected to the new repository separately.

Production remains gated by explicit merge approval and the setup described in current-production-prerequisites.md. Moving source code does not itself make the destination a live, production-verified deployment.
