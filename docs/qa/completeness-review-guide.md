# Review the evaluation-completeness changes

## Publish

From the repository in a normal authenticated terminal, run:

```sh
bash scripts/publish-completeness.sh
```

The script verifies the account, repository and branch, fetches the current remote, stages only the named implementation files, commits, pushes without force, and creates or updates the matching PR. It refuses pre-existing staged changes and never merges. It prints actual PR/check information; it does not invent a Preview URL or deploy an additional review site.

## Preview boundary

Use the Cloudflare bot URL posted on the new PR. Native review deployments use synthetic fixtures and credential separation. A synthetic Preview is suitable for UI inspection; it does not demonstrate live GitHub synchronization, organizer writes, Docker execution, cache hits or artifact storage. The live organization review backend needs these changes and migrations 0011–0013 deployed to isolated review resources before testing those operations. No production migration or deployment is authorized by this guide.

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

The current revision passed static checks and a Cloudflare dry-run build. Unit tests were not run after the user's stop instruction. Browser and live validation of this revision are still required; record actual outcomes in the acceptance ledger rather than marking source presence as a verified PASS.
