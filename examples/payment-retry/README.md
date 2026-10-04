# Payment retry acceptance profile

This is an organizer-authored example, not a participant submission or an inferred
requirement from an issue title. Select `payment-retry-v1` only after approving it
as part of a challenge contract. It does not call a real payment provider.

The submission must provide a dependency-free `server.mjs`, started with Node 24.
It listens on `0.0.0.0` and `process.env.PORT` (9000 in the sandbox).
`POST /payments/retry` takes `{outcomes, maxAttempts}`. Outcomes simulate a provider:
`temporary`, `permanent`, `success`. Respond with exactly `{status, attempts}`:
stop on success, stop on a permanent failure, and never exceed `maxAttempts`.
For non-positive `maxAttempts`, return HTTP 400 and `{error:"INVALID_ATTEMPTS"}`.
The trusted checks are versioned in `src/runner-policy.ts`, not in the submission.

The supplied server is a passing reference fixture. It may be used in a dedicated
organizer test PR; do not credit it as participant work. The current payment-engine
README PR does not implement this behavior and cannot pass this profile.

Execution requires the explicitly enabled isolated runner. Deployment remains disabled
on the current free Cloudflare account. Selecting the profile does not enable compute.
