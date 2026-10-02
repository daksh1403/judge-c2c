# Item-level acceptance audit — 2026-10-03

This cycle replaces every generic ledger placeholder with a scoped finding. It examines all 714 entries, including previously checked entries, against existing code, test assertions and preserved real payment evidence. It is not a claim that every production workflow was executed.

## What was repaired

- Native issue-label events previously treated every non-bot actor as an organizer override. A participant could suppress evaluator labels. Only numeric GitHub identities explicitly configured in event policy now receive that authority; other changes create an audit record.
- Approved challenges could receive new assignments after GitHub closure. Both the preflight and transaction now require an open native issue. Existing assignment history and organizer-controlled completion remain separate.
- Reservation expiry changed status without an audit record. Maintenance now expires and records the change transactionally, then reconciles labels. Inline expiry is scoped to its target issue so it cannot strand other issues’ labels. Closed unassigned challenges appear closed rather than available.
- Advisory priority/difficulty/domain classification and labels were absent. Controlled taxonomy now includes them; only explicit structured priority/difficulty proposals are parsed, and ambiguous values remain unset. Organizer decisions take precedence.
- Several controlled issue types had no rule. Conservative rules cover the configured type set; mixed types remain needs-triage. Security signals persist even when an explicit documentation label is present.
- Repeated issue reports had no moderation signal. Twenty previous reports by the same reporter in the same repository within an hour, measured using native GitHub creation timestamps, produce possible-spam, never deletion, automatic rejection or credit. This is not account-wide rate limiting.
- Issue queries lacked team/label/progress/priority/difficulty combinations, and organizer review lacked priority/difficulty/severity/recognition inputs. Backend and UI now expose those operations.
- Execution result kinds supported only build/test/lint. Trusted policies may now distinguish other supplemental check kinds; the image must supply the actual tools. No participant dependency installation or network permission is introduced.
- The ledger accepted generic audit notes and PASS based on any nonempty evidence string. Validation now rejects placeholders, source-only PASS, wrong item count/IDs, rewritten requirements and nonexistent local evidence against a separate authoritative requirement manifest.

## Evidence boundaries

Tests use actual D1 migrations with fixture GitHub identities/API responses. They do not manufacture independent real GitHub accounts. Existing payment evidence separately records real App webhooks, frozen baseline/head, controlled Docker execution, CallMissed and exact-head Checks.

Every entry now records a verification method and boundary. SOURCE_INSPECTION proves code was examined, not runtime success. NOT_IMPLEMENTED means a concrete capability is absent. Remaining UNVERIFIED entries identify actual unexecuted operational scenarios, rather than an unprocessed audit placeholder.

AI narrative accuracy remains a confirmed defect: a partial report claimed a bound test was absent, although that test exists. The UI explicitly distinguishes model interpretation from trusted proof. No attempt is made to hide this defect by changing acceptance expectations.

## Remaining launch gates

- Appropriate production hostile-code execution capacity and production provisioning/approved merges.
- Enabled object storage, large artifact capture/retention and storage-failure drills.
- Per-person identities and participant/team-scoped authorization, plus restricted security report ingestion.
- Calibrated specialist security/quality/architecture review and verified additional-contribution records.
- Baseline/dependency/index caches, deterministic API compatibility/symbol analysis and adaptive evaluation depth.
- Comprehensive telemetry and real event-scale bursts, service/database/queue/storage recovery drills.

The complete backlog is the generated master ledger, including scoped PARTIAL entries. A smaller UNVERIFIED count reflects classification of known gaps, not their implementation.

## Verification

Final test counts, real GitHub observations and deployment state are recorded in the accompanying evidence JSON and the new audit PR. No PR is merged by this work.

GitHub issue forms follow the [official issue-template mechanism](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository). They are supplied for Judge-C2C; deploying them to every challenge repository remains separate reviewable work.
