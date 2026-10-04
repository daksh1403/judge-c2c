# Review the evaluation-completeness changes

## Publish

From the repository in a normal authenticated terminal, run:

```sh
bash scripts/publish-completeness.sh
```

The script verifies the account, repository and branch, fetches the current remote, stages only the named implementation files, commits, pushes without force, and creates or updates the matching PR. It refuses pre-existing staged changes and never merges. It prints actual PR/check information; it does not invent a Preview URL or deploy an additional review site.

## Preview boundary

Use the Cloudflare bot URL posted on the new PR. Native review deployments use synthetic fixtures and credential separation. A synthetic Preview is suitable for UI inspection; it does not demonstrate live GitHub synchronization, organizer writes, Docker execution, cache hits or artifact storage. The live organization review backend needs these changes and migrations through 0015 deployed to isolated review resources before testing those operations. No production migration or deployment is authorized by this guide.

## Judge checks

On the updated organization review backend:

1. Open a completed evaluation. Confirm mandatory and optional requirements remain separate, every criterion has evidence links, and functional source-only checks remain UNVERIFIED.
2. Push a new PR commit or open a historical run. Confirm the current head and latest run are explicit; old evidence is not presented as current.
3. Inspect baseline/head execution comparisons. Repeated or missing executions must show ambiguity rather than select a convenient result. Cache origins and original execution times remain visible.
4. Inspect artifact states. Downloads require authenticated access, valid integrity and unexpired stored content. Judges cannot recapture artifacts; organizers can retry terminal-run capture only when storage is configured.
5. Propose additional work as an organizer using a frozen allowed category, changed paths, known evidence and optional criteria. Passing checks alone cannot establish new work; objective baseline FAIL to head PASS and the appropriate evidence kind are required. Unbound claims remain UNVERIFIED.
6. Recognize or reject a candidate with a meaningful reason. Recognition verifies configured criterion improvement separately from design/file attribution and scoring. Stale decisions, closed/obsolete/ineligible submissions, policy failures and regressions must be rejected. A judge cannot mutate records.
7. Sort submissions newest/oldest. Inspect recent-stage timings: sample counts, missing measurements and truncation must remain explicit.
8. Activate an eligible reservation as an organizer. Its frozen contract/policy must remain unchanged; only the winning state transition is audited and reconciled.

9. Inspect expected artifacts declared by a frozen contract. Missing/expired/failed required captures must prevent ACCEPTED even when criteria pass; valid metadata alone is not content proof or functional evidence.
10. Inspect the review plan, selected model and routing reason. Documentation, sensitive and large/performance cases should take the configured contextual path; all contract checks remain required. Invalid optional identifiers must fall back safely. Provider availability needs actual verification.
11. Add a same-team shared-issue alternate/duplicate/superseding relationship as an organizer. Repeat the request, attempt a cycle/cross-team link and inspect audit/history. A judge POST must be rejected. Scores and evaluation states must remain unchanged.
12. Inspect organizer system observations after issue/PR traffic. Missing data is not healthy operation; failure/latency/rate-limit aggregates must match controlled request outcomes. Judges cannot access infrastructure telemetry.
13. Recalibrate actual CallMissed output on the previous false-coverage case, manipulated tests and conflicting evidence. Confirm unverified narrative labels and human attention; do not close 33.09 from valid citations alone.

The current revision passed static checks and a Cloudflare dry-run build. Unit tests were not run after the user's stop instruction. Browser startup is blocked by local listener EPERM, and live validation is still required; record actual outcomes in the acceptance ledger rather than marking source presence as a verified PASS.
