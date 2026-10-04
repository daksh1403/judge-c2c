This change adds judge-facing review and evaluation safeguards while preserving frozen inputs and objective-first judging.

- Judge details separate mandatory/optional criteria, evidence, current versus historical heads, baseline/head checks and original execution provenance.
- Additional contributions have immutable candidates, optional-criterion baseline-to-head verification and audited organizer recognition/rejection. Recognition cannot change mandatory results or award scores automatically.
- Organizer reservation activation preserves frozen assignment policy/version and atomically records audit/reconciliation state.
- Opt-in execution reuse verifies exact inputs and original provenance; benchmarks and incomplete/redaction-altered results bypass reuse.
- Protected artifact storage adds integrity checks, retention, bounded recovery and organizer-only recapture. Backing storage requires isolated provisioning.
- Credential observations remain location-only and uncertain attribution stays UNVERIFIED; redaction handles serialized JSON and quoted credentials.
- Judges can sort submissions oldest/newest and inspect bounded recorded queue/stage timings.

This workstream also adds:

- Objective projections replace model criterion prose; unsupported OBSERVED claims are downgraded, contextual narratives and historical reports require human attention, and relevant failures cannot be hidden by another passing result. The prior false-coverage calibration remains an explicit FAIL until real-provider verification.
- Explainable bounded contextual review plans and optional provider-specific LIGHT/DEEP model overrides preserve all frozen criteria and trusted execution checks.
- Typed expected artifacts, judge availability status and integrity-checked required captures before organizer acceptance.
- Immutable audited ALTERNATE/DUPLICATE/SUPERSEDES annotations between mapped same-team attempts, with atomic capacity/cycle guards and idempotency. They preserve all independent evaluations and do not award scores.
- Fixed numeric GitHub/webhook operational aggregates with retention and organizer-only visibility.

Validation: TypeScript, JavaScript syntax, acceptance-ledger consistency, diff checks and Cloudflare review dry-run build passed. All 15 migrations applied successfully to in-process SQLite with no integrity or foreign-key violations; this is not Cloudflare D1 behavioral proof. Independent adversary review cleared corrected source and cross-component contracts. No subsequent unit tests were run at the user's request. Browser/live evaluation of this revision remains pending; historical evidence is not claimed as proof for the new code.

Preview: use the native Cloudflare bot-provided URL after push. No additional manual Preview deployment or URL was created. Production and event-scale hostile execution are not certified by this PR. Do not merge automatically.

Review guide: docs/qa/completeness-review-guide.md. Full acceptance status: docs/master-acceptance.md.
