# Operations and readiness

The foundation has one high-entropy organizer bearer credential. Add individual verified
identities, scoped roles and audit actors before a multi-organizer event. Rotate secrets
through Wrangler. Protect GitHub branches and deployment environments independently.

HMAC validates raw bounded bytes before payload/repository/installation/assignment checks.
GitHub signatures have no signed timestamp. Persistent delivery identity plus exact-input
identity suppress replay, event timestamps order updates, and the evaluator rechecks the
current head. Keep delivery identities throughout the event. See
[GitHub validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Preview builds require approval of the exact commit and a separate account token because
malicious application PRs can exfiltrate build credentials. No `pull_request_target`
workflow runs PR code. Preview runtime data comes from public GitHub PRs and reviewer-authored expectations.
Only per-session test evaluations can be created; privileged organizer writes are disabled.
Review D1 is separate from production and contains no production secrets.

## Recovery

- D1 batch transactions commit runs, supersession and outbox together. The two-minute
  production cron reconciles undispatched queued work. Durable workflow IDs equal run IDs.
- Stages recheck the latest submission. Input history survives supersession. Bounded
  fetches have timeouts and no redirects; stale work stops at stage boundaries.
- GitHub failures/rate limits get bounded retries. Persisted objective evidence survives
  stage failure. Logs never contain provider response bodies or credentials.
- AI receives two bounded attempts. Failure produces an objective-only report and explicit
  AI failure. Oversized context skips reasoning instead of truncating authoritative rules.
- Authorized retries create new attempts; failed history is preserved. Publication retries
  reuse Check external IDs after lost acknowledgments. Exhausted publication failures
  require operator inspection; scheduled publication recovery is a follow-up.

Logs include correlation identity, sanitized error code, duration and HTTP status; never
headers or request bodies. Recognized secrets are redacted from retained source/patch
context. Arbitrary secrets cannot be perfectly detected; a stronger scanner/artifact
redaction policy is pending. Never put sensitive data in public challenges/model context.

## Current deployment

On 2026-10-02 the review Worker was deployed and its separate D1 database migrated.
Local D1 integration tests validate the SQL. R2 creation was rejected because R2 is
disabled. Existing OAuth can deploy Workers but Workers Builds administration/log APIs
returned 403. The PR discovered an existing native Builds connection for `judge-c2c`;
its initial build failed, and root Worker naming/build configuration was corrected.
The next native build passed. Preview URL routing was enabled (production route remains
disabled), and the automatic branch Preview at
`https://feat-evaluation-foundation-judge-c2c.dakshx.workers.dev` returned HTTP 200.
The root preview configuration now binds the separate review D1 and the existing public
review Workflow. The internal `judge-c2c-review` host has no public routes and no judging
secrets. Its Workflow stages must be deployed before pushing changes to the PR preview. Native Previews are active and update on branch commits.
No scoped Actions deployment token or evaluation GitHub App credentials were available.
GitHub also rejected required-reviewer environment protection with a billing-plan error.
Only the alternative Actions deployments stay disabled pending a supported approval gate
and credentials. Keep production judging secrets out of native preview parent/base config.
No production version was deployed by this work.

## Real-event gates

- Register/install the App and verify genuine events, exact-head reads and Check publication.
- Freeze baselines, approve contracts and map teams/issues.
- Implement/provision isolated execution and trusted checks; precompute baseline evidence.
- Enable R2 and verify bounds, integrity, redaction and artifact retention.
- Add individual authentication, authorization and audited human adjudication.
- Exercise staging supersession/retries and GitHub/AI/storage failures end to end.
- Run adversarial sandbox/egress/resource drills on disposable runner infrastructure.
- Measure deadline-burst queue delay, latency and resource capacity; add budgets/alerts,
  backup/retention/recovery and rollback.
- Review CI and the preview. Human decides merges; production stays disabled until ready.

## Public PR review workspace

`PREVIEW_TESTING=true` is honored only in `local`/`review`. Browser sessions use random
256-bit HttpOnly SameSite=Strict cookies, hashed database identities and owner-scoped reads.
Mutations require an exact same-origin header. URL validation restricts input to GitHub
PRs; all outbound reads use fixed `api.github.com` and `raw.githubusercontent.com` endpoints,
exact SHAs, bounded bodies,
timeouts and no redirects. GitHub authorization headers are absent. No code is executed.
Expectations, request keys and captured commit snapshots are immutable; a new submission
action makes a new attempt. Source content is hashed rather than retained, and recognized
credentials are redacted from patches. Do not treat this as a complete secret scanner.

Limits: ten requests per IP/session per hour, twenty global reviews per hour, ten active
runs, 100 changed files, 100 KB source reads, 5,000 characters per displayed patch. A
two-minute cron on the existing internal host redispatches undelivered work and fails
runs older than fifteen minutes without erasing evidence. Session access expires in
24 hours; test runs are removed after seven days. Review cleanup never touches the
production evaluation tables. Unauthenticated GitHub API rate limits may be shared by
Cloudflare egress; GITHUB_HTTP_403/429 remains an explicit failed review.

Apply review migrations with `npx wrangler d1 migrations apply DB --env review --remote`,
then update the existing internal host with `npm run deploy:review`. Native Previews bind
this deployed Workflow, so they do not each run independently versioned Workflow code.
Root/main public routes remain disabled; updating the host does not deploy live judging.
After pushing, inspect native Builds and test the **existing** branch URL. Verify an
actual public PR completes and another browser cannot read its run. A browser fixture
test alone is not evidence of a deployed GitHub-to-Workflow-to-D1 evaluation.

PR preparation persists the baseline-relative file comparison once; objective checks reuse
it rather than requesting the same diff again. Public source assertions read bounded UTF-8
files at exact SHAs from GitHub raw storage without credentials. This reduces REST API
usage while keeping immutable attribution. It does not remove metadata API rate limits.

A trusted operator can prepare public PR metadata using
`node --experimental-strip-types scripts/prepare-public-pr.mjs <public-PR-URL> --remote`.
The script uses unauthenticated GitHub reads on the operator's network and stores normalized
public PR/compare metadata with capture time and a SHA-256 digest. No participant code runs.
There is no HTTP write endpoint for this immutable cache. On GitHub 403/429/5xx only,
preparation may reuse a matching cache captured within 24 hours. It validates repository,
PR, public visibility, exact commits and digest, then marks latest-head refresh UNVERIFIED
and displays its provenance. Missing, mismatched or corrupt cache entries cannot produce
a silently fabricated current submission. Prepared caches are a review testing aid, not a
replacement for the installed GitHub App required for live hackathon evaluation.

## Organization test integration

The existing internal `judge-c2c-review` host also serves the authenticated organization
console through `ORG_SERVICE`; no additional public URL is provisioned. `ORG_DB` is
`judge-c2c-organization`, separate from synthetic and public-review sessions.

Apply both databases' migrations before updating the host:

```sh
npx wrangler d1 migrations apply DB --env review --remote
npx wrangler d1 migrations apply ORG_DB --env review --remote
node scripts/bootstrap-organization.mjs --remote
npm run deploy:review
```

Bootstrap saves private access/vault files under ignored `.wrangler/` with mode 0600,
and uploads only to the internal host. It reuses existing valid values; do not delete
or rotate the vault key without decrypting/re-encrypting the stored App credentials.
Back it up privately. Never bind these secrets or ORG_DB to the public preview Worker.
The script repairs a trailing literal newline left by an earlier bootstrap version.
For local integration, bootstrap without `--remote` and migrate ORG_DB with `--local`.
Local registration needs a reachable HTTPS callback and should use a separate test App.

Login creates an eight-hour HttpOnly session; logout revokes it. Registration state
expires after one hour. Ten login attempts per minute per IP are permitted. Only the
configured exact origin may invoke the console. The single organizer access code is a
test bootstrap credential; rotate it and revoke all sessions if compromised. Separate
organizer identities and roles are required before broader hackathon use.

After owner approval, installation-repository events refresh selected access; deletion
or suspension revokes repository visibility and supersedes active work. Token minting
also enforces GitHub's current access. Repository sync can be retried from the console.
Check the actual App webhook deliveries and Check publication on an assigned real PR
before claiming the end-to-end integration is proven. App registration, installation,
and a real assigned submission must be tested with owner approval; mock fixtures do
not prove these external steps.
