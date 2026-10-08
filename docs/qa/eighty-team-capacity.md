# Synthetic 80-team capacity and recovery

This change tests the judging control plane without requiring an actual team
roster. It does not certify 80 simultaneous real VM workloads, provider quota,
arbitrary application runtimes, or error-free operation.

## Reproduced failures

- A submission exhausted the old 16 × 15-second reviewer-capacity retry budget
  and became FAILED while another valid review occupied the provider slot.
- An 80-submission preparation burst reached 160 simultaneous source-file
  requests in the controlled fixture, above GitHub's documented secondary
  concurrency limit. The fixture uses one shared documentation challenge.
- Actions attempts used a single 12-minute deadline starting at dispatch.
  A job queued for 20 minutes could not claim its input even though no guest had
  started. The 10-minute Actions job budget also included trusted setup despite
  allowing a participant execution budget of up to 600 seconds.
- Provider HTTP 429 ended review without a later workflow-level retry. A
  provider lease limited concurrency but did not delay other submissions after
  a rate-limit response.
- Outage recovery selected newer queued submissions first, allowing a steady
  arrival stream to delay older retained current submissions.

## Changes and bounds

GitHub preparation and initial Actions source capture share four leased slots.
An individual preparation fetches at most eight file requests in parallel, so
the controlled file fan-out is bounded by 32. Organization workflows and
diagnostics coordinate with the original control database while their
evaluation records remain in the organization database. Leases expire after
three minutes, renew during source reads, and use owner-fenced cleanup.

Reviewer capacity waits use durable `step.sleep` outside a running step instead
of four minutes of retries. The review acquires, renews and releases its lease
within the reasoning step; ephemeral lease handles are not cached across steps.
Waiting rechecks current head and eligibility before spending compute. There
are at most 600 30-second wait intervals, with bounded additional provider
backoff. Preparation has 240 30-second wait intervals. These are finite budgets,
not a guarantee of completion during an indefinite outage.

An Actions workflow polls durably through the objective step's retry mechanism.
Each pending poll reads transport metadata and frozen policy rather than
decoding all source. Dispatch is reused for the same immutable request. A
completed baseline is resumed within the same evaluation without inserting
duplicate execution records; a separate evaluation retry still has a new run
and attempts. Queue admission has a two-hour deadline; a claim starts a separate
12-minute execution deadline, bounded also by the original expiry. The guest's
contract timeout is unchanged. The Actions job has a 20-minute overall limit
including trusted setup. Ambiguous dispatch failures remain recorded and are
fenced against delayed claims, with at most eight failed dispatch attempts for
the same request. Expiry never produces functional PASS.

HTTP 429, HTTP 5xx and provider timeout/unavailability may receive up to five
additional workflow-level review attempts. Other failures, including rejected
credentials and unsupported model claims, do not get this transport retry.
Every returned AI attempt is preserved in the audit history. Shared cooldown
leases last 60–300 seconds after a retryable provider failure; durable per-run
backoff is 30–300 seconds. Exhaustion retains objective evidence and a failed
review for human attention. Validation and authoritative checks remain intact.

Outbox recovery still dispatches at most five items per sweep, selecting oldest
current queued work first. Superseded work remains excluded. Direct intake
dispatch and durable outbox retention continue to handle normal arrivals and
creation failures.

GitHub clients share a coordination cooldown while preserving per-database
telemetry. HTTP 429, a rate-limited 403, and successful responses exhausting the
quota record the `Retry-After`/quota-reset deadline. Preparation admission waits
and clients make no further HTTP calls until that deadline. Absent a supplied
deadline, the cooldown is at least one minute; scheduling metadata is bounded
to a day. Authentication failures do not masquerade as rate limits.

## Verification boundary

- The complete production workflow runs over 80 synthetic team/submission
  records in SQLite using the project's migrations, constraints and triggers.
  GitHub and model calls are controlled fixtures; sleeps are accelerated. All
  80 evaluations and publications finish, review concurrency stays at one,
  source fan-out stays within 32 and source-only functional evidence never
  becomes execution PASS. This is a logical workload simulation, not a latency
  benchmark or a native GitHub permission/registration test.
- A separate 80-request burst runs through two real Miniflare Worker isolates
  sharing D1 and proves single provider ownership, recovery after lease expiry
  and stale-owner fencing.
- The real Miniflare Workflow engine sleeps for the configured 30 seconds,
  then supersedes a changed head without calling the provider. Miniflare may
  report `running` during sleep; the test measures actual durable elapsed time
  rather than asserting a Cloudflare concurrency counter.
- Protocol fixtures prove late queue admission, separate claimed expiry,
  immutable inputs, replay rejection and exactly two snapshots/dispatches/
  execution records while repeatedly polling baseline and submission.
- Controlled HTTP 429 fixtures cover recovery and persistent exhaustion with
  retained AI attempts. Existing real durable-engine tests cover GitHub
  exponential retry and D1 outage recovery. VM isolation is verified separately
  by the genuine Linux/QEMU CI canary.
- GitHub HTTP 429/403 and successful final-quota fixtures prove other clients
  and preparation wait until the supplied deadline, without extra HTTP calls.

The first HTTP-proxy-backed 80-workflow local test exhausted localhost ephemeral
ports (`EADDRNOTAVAIL`); it is not represented as a Cloudflare outage. The large
logical simulation uses in-process SQLite, while dedicated real Worker/D1 and
Workflow-engine tests retain the platform boundary checks.

One full local check under unrestricted test parallelism timed out two existing
5-second runtime scenarios. Both passed in isolation. Vitest now limits runtime
test workers to four rather than launching workerd/D1 suites for every CPU core;
timeouts were not relaxed. Fresh full verification is required after that change.

## Platform constraints and rollout

GitHub documents 20 concurrent standard hosted jobs for GitHub Free, secondary
API concurrency limits, and additional rate limits. Cloudflare excludes durable
sleeping/retrying instances from active Workflow concurrency. These facts do
not reserve execution capacity or grant unlimited provider quota. See
[GitHub Actions limits](https://docs.github.com/en/actions/reference/limits),
[GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
and [Cloudflare Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/).

This feature branch is for review. Production remains pinned to the previously
approved main SHA. After explicit merge/deployment approval, apply migration
0026 to both workspace databases and update the exact runner workflow SHA in
the private deployment profile before dispatching new jobs. Verify no live
attempts need the old pin, deploy approved main, and run a fresh synthetic
Actions/provider diagnostic. Never provision production App/provider keys in
the review preview. Team registration and actual challenge inputs remain
separate work.

## Local verification

Fresh `npm run check` passed all 554 tests across 63 suites, validated all 714 acceptance entries and built the Worker dry run. All 35 local browser scenarios passed. PR CI, the genuine Linux/QEMU canary and the credential-free Cloudflare review deployment are separate checks and must be inspected for the pushed commit before approval.
