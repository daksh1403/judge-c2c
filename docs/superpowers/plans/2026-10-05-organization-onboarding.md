# Organization Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute the tasks sequentially and review each task.

**Goal:** Connect any administered GitHub organization through a fresh event workspace and retire the private rehearsal connection after verifying its replacement.

**Architecture:** Keep one organization per independently provisioned Worker and D1 resources. Generalize configuration names and add a read-only planning/provisioning CLI with private resumable state. Organizer-authorized retirement revokes the old installation and fences intake while keeping historical evaluations readable.

**Tech Stack:** TypeScript Worker, D1, existing pinned Wrangler, Node ESM scripts, authenticated gh API, Vitest/Miniflare and Playwright.

## Global Constraints

- No feature writes to main or automatic merge. Runtime source must be owner-approved before event deployment.
- Participant code only runs in the isolated runner; never give credentials to participant workloads or AI.
- New workspace resources and secrets are fresh. Do not copy the rehearsal configuration or database rows. Inspect identifiers only to deny reuse.
- Retain all immutable contracts/assignments, failed and superseded runs and judge history.
- The event organization is not named yet. Do not provision a made-up live organization or disconnect the current private App now.
- GitHub registration/install callback identity checks remain exact per workspace. Never loosen them into shared tenancy.
- Current production defaults remain compatible. No billing enablement, secret values in git or live multi-org certification from synthetic tests.

### Task 1: Arbitrary-organization workspace preparation and connection verification

**Files:** Modify `scripts/production-config.mjs`, `package.json`, `tests/production-config.test.ts`; create `scripts/organization-workspace.mjs`, `tests/organization-workspace.test.ts`, and `docs/organization-onboarding.md`.

**Interfaces:** CLI `npm run organization:setup -- --organization NAME --workspace NAME` plans by default. Explicit `--apply` provisions fresh resources and secrets; deployment requires an additional explicit flag and an approved runtime check. Export the planning/provisioning core from the ESM module for adapter-based tests. Add `npm run organization:verify` or a verify subcommand that authenticates to the prepared workspace, checks the expected installed App/organization through real GitHub truth and verifies runner diagnostics before allowing retirement. Resource IDs and secret values are held only in ignored mode-0600 journal/private files.

- [ ] Write failing tests for two arbitrary organizations with distinct Worker/Workflow/database/artifact names, current defaults, rejected collisions with native/review/current production resources, denied non-admin membership before mutations, no secret inheritance/logging, and resumable provisioning failures.
- [ ] Run `npx vitest run tests/production-config.test.ts tests/organization-workspace.test.ts` and observe the missing behavior fail.
- [ ] Implement strict organization/workspace names, output paths that preserve relative source/migration resolution, and unique config names. Read known deployed resources only to deny reuse. Validate all inputs before writes. Plan reads GitHub identity/membership using authenticated gh, never prints tokens, and shows exact intended resources. The provision adapter invokes pinned Wrangler for fresh resources, separate migrations and secrets with stdin, persists each completed stage, and fails closed on existing-name/resource mismatches. Do not overwrite the current `.wrangler/production.json` or GitHub environment.
- [ ] Implement verification with expected organization and installation ownership/permissions, selected repository access, authenticated workspace status and signed runner diagnostic. Provider failure remains visible; it does not fabricate functional evidence. Persist a bounded verification record so the later CLI retirement step can check the exact verified target.
- [ ] Re-run focused tests, review the actual diff for copied bindings/secrets or accidental mutation in plan mode, update operator docs and commit this task.

### Task 2: Audited retirement with retained history and execution fencing

**Files:** Create `src/organization-retirement.ts`, `migrations/0024_organization_retirement.sql`, `tests/organization-retirement.test.ts`; modify `src/organization.ts`, `src/organization-workflow.ts`, `src/github.ts` if required for accepted-empty uninstall responses, and relevant workflow/intake fencing only where necessary; extend `scripts/organization-workspace.mjs` and its tests for replacement verification followed by retirement.

**Interfaces:** Organizer-only `POST /api/organization/retire` requires exact current organization confirmation and the replacement workspace identity/verification reference. The setup CLI calls this only after its replacement verification passes, using credentials solely with their intended origins. Record who authorized replacement retirement; an organizer attestation is not an AI or functional criterion proof. `GET /api/organization/status` exposes ACTIVE/RETIRING/RETIRED and sanitized replacement details to authenticated organizers. A helper checks retirement before intake, new runs/retries and scheduled GitHub publication.

- [ ] Write failing Miniflare tests for unauthenticated/judge/participant rejection, wrong exact-name refusal, replacement equal to old organization refusal, pending/failed replacement verification refusal in CLI, GitHub uninstall failure and safe retry, successful revocation, retained completed/failed/superseded rows, fenced in-flight/new work, and read-only archive access.
- [ ] Run `npx vitest run tests/organization-retirement.test.ts tests/organization.test.ts tests/organization-isolation.test.ts` to observe the missing behavior fail.
- [ ] Account for the current GitHub uninstall contract: DELETE /app/installations/{id} uses an App JWT and returns 202 Accepted, potentially with an empty body. Keep RETIRING until an authoritative follow-up GET confirms removal (404). Retry safely after accepted deletion or outage; do not mistake JSON parsing failure for evidence that uninstall never occurred. Verify the old installation app/account identity before any uninstall. Primary reference: https://docs.github.com/en/rest/apps/apps#delete-an-installation-for-the-authenticated-app.
- [ ] Implement a small persisted ACTIVE → RETIRING → RETIRED state machine. Fence intake before attempting uninstall; retain RETIRING and an actionable safe failure if uninstall fails. Revoke the exact old installation using the old App JWT, treat already-uninstalled as success after inspection, mark selected repos inaccessible, supersede active attempts without deleting any evaluation rows, and audit each state. Retired credentials cannot mint new tokens; archive reads use existing persisted artifacts/evidence and do not invoke GitHub. Add worker-stage checks so an already queued job cannot publish or start new participant execution after retirement.
- [ ] Add explicit CLI retirement command requiring old workspace origin/token-file and exact organization name, plus the verified new workspace journal. Validate different organization/resource identity and freshness; verify the new connection again before calling old retirement. Never retire the currently selected new target. Do not retire anything in this session because the replacement org is unknown.
- [ ] Re-run focused tests and all directly changed workflow tests, inspect concurrency/failure boundaries and commit this task.

### Task 3: Guided frontend states, review deployment and completion verification

**Files:** Modify `public/organization.js`, `tests/browser/dashboard.spec.ts`, `docs/organization-deployment-profile.md`, `docs/organization-onboarding.md`; add scoped QA evidence after actual executions.

**Interfaces:** The frontend explains which organization is configured, guides App registration for it and supports organizer-only old-workspace retirement with exact confirmation and explicit replacement verification acknowledgement. The retired console displays historical evidence read-only and a clear replacement link; it does not offer App registration, reconciliation, retries, contribution decisions, participant writes or fresh execution. The new workspace never shows old team/repository data.

- [ ] Write failing browser tests for arbitrary organization labels/registration links, retirement confirmation, failed uninstall recovery, retired read-only history and absent judge/participant retirement controls. Use synthetic fixtures without production credentials.
- [ ] Run the relevant browser tests and observe the missing behavior fail.
- [ ] Implement the guided states using existing frontend patterns, keeping Cloudflare IDs, vault keys and setup journal internals out of the end-user interface. Show no false success before retirement completes. Update deployment and transition docs with actual commands and supported boundaries.
- [ ] Run `npm run check` and `npm run test:browser`, inspect results, restore unrelated generated evidence churn, and review the whole branch.
- [ ] Commit/push, create the feature PR, verify exact pushed commit and current-head checks, retrieve the bot-provided Cloudflare URL and run browser verification with REVIEW_URL. Keep production and event resources untouched. Update the PR with concrete validation and remaining live organization-installation/provider/capacity limitations. Never merge without user authorization.
