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
workflow runs PR code. Preview runtime data is synthetic and writes are disabled.

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
The root preview configuration has no state or execution bindings; the connected Worker
has no configured secrets. Native Previews are active and update on branch commits.
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
