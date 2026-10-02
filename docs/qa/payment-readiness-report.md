# Payment-engine readiness validation

This is a real GitHub integration rehearsal using one authenticated operator and an explicitly named QA team. Multiple actor identities remain fixture tests; no competition points are awarded.

## Frozen challenge and submission

- Runnable baseline: [payment-engine PR #5](https://github.com/Daksh-Codebase/payment-engine/pull/5), frozen commit `65cb717281eaa2aced69dfaa68ac06c6d540ce2a`. Native GitHub CI passed. No merge performed.
- Official challenge: [issue #6](https://github.com/Daksh-Codebase/payment-engine/issues/6), approved in Judge-C2C while preserving its original participant-report provenance. The same real account operates organizer administration and the QA participant.
- Authoritative contract: `examples/payment-engine-contract.json`, eighteen trusted HTTP criteria plus supplemental build, repository tests and lint. Contract version is pinned at assignment; participant files cannot change it.
- Native [claim comment](https://github.com/Daksh-Codebase/payment-engine/issues/6#issuecomment-5952460270) created assignment `assignment-b83b2718-525a-4cda-aff6-da4abaad0cd8`, source CLAIM, team `team-67b28fd4-8d8a-4920-b861-ae42fc0ae980`, contract `ad08e7d0b5772e69e717040a1662ed347f52866448f22219aa37abe9500ffd73`.
- [Submission PR #7](https://github.com/Daksh-Codebase/payment-engine/pull/7) maps correctly to issue #6 and the QA team. Exact head `749b414d1036a0c1b734af807e681e4894d2345e`; native GitHub CI passed, fourteen native tests.
- Evaluation `6b15772153dc2c2058281a7c2249fd79957ec1da57bedf05b835cc277761ebd3` contains separately stored Docker execution for frozen baseline and submission. Baseline fails transient and bounded retry criteria; submission passes all eighteen criteria and three supplemental commands. Both preserve the six existing payment behaviors.

## Permission verification

Authenticated GitHub API confirms installation 167005353 now grants Issues write and subscribes to Issues and Issue comment events. App-owned tokens are explicitly downscoped for evaluation and management operations. The installation also grants unnecessary Pull requests, Repository hooks and Workflows writes; reducing the App definition remains least-privilege follow-up.

## Pending release gates

CallMissed Kimi K2.6 completed structured requirements and observable approach review; all eighteen criteria are PASS with known evidence IDs. GitHub Check 110840780853 is completed/neutral on the exact submission head, with publication PUBLISHED. Detailed normalized evidence is in `docs/qa/payment-live-evidence.json`. Live GitHub issue #6 now has `judge:source:participant`, `judge:status:assigned`, `judge:evaluation:not-scored` and `judge:evaluation:approved-challenge` labels applied by the App. Type classification remains uncertain. The deployed organizer browser check without API mocks confirms the correct QA team, PR #7 and exact current head, with no browser errors and a fitting mobile viewport; evidence is in `docs/qa/payment-dashboard-evidence.json`. This report does not assert launch readiness. Production isolated capacity, broader scans/benchmarks, role-specific authorization and the full master acceptance audit remain separate gates. The development Docker VM is not a production hostile-code execution service.

## Review corrections

Standards review found development-workflow PASS items incorrectly citing browser fixtures; they now cite actual open PRs or remain UNVERIFIED. Spec review found pending/running GitHub Checks are not implemented; the master checklist now explicitly records that gap. Completed Check publication is verified separately.
