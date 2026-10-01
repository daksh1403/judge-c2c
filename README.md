# Judge-C2C

GitHub engineering evaluation with immutable contracts, baseline comparison and
evidence-backed human review. AI interprets evidence; it does not establish facts.

**[Cloudflare review](https://judge-c2c-review.dakshx.workers.dev)** — read-only,
explicitly synthetic data. This foundation is not ready to judge a real event.

## Delivered foundation

- TypeScript Cloudflare Worker and responsive judge dashboard.
- Protected organizer APIs for versioned contracts and PR/team/issue assignments.
- Raw webhook HMAC validation, repository/installation allowlists, delivery deduplication,
  exact-input identity, transactional D1 outbox and scheduled reconciliation.
- Immutable baseline/head/contract/team snapshots, supersession and auditable retry attempts.
- Short-lived repository-scoped GitHub App tokens, bounded commit contents/diffs and
  rejection of non-descendant baselines or truncated comparisons.
- Objective source/documentation assertions and protected-path checks with baseline
  attribution. Explainable risk signals flag sensitive components/dependencies/CI/test deletion.
- Optional Workers AI requirement review: versioned policy, bounded context, validated
  schema/evidence references, rejection of unsupported PASS and waived criteria.
- Durable evaluation stages, partial evidence, concise GitHub Check publication,
  protected R2 artifact support and correlated structured logs.
- CI and isolated per-PR Cloudflare deployment definitions. Automated deployments remain
  disabled until scoped environment credentials are configured.

**Participant execution is not implemented in this slice.** Build/tests/scanners/coverage/
benchmarks do not run. Functional criteria remain UNVERIFIED. A passing literal assertion
confirms only that exact source/documentation criterion. No score is assigned. Additional
contributions receive no credit without evidence.

## Local development

Use Node 24 (minimum 22.12) and npm. Dependencies are pinned.

```sh
npm ci
npm run db:local
npm run dev
```

Open `http://localhost:8787`. Default mode uses synthetic fixtures and rejects writes.
For local live mode, copy `.dev.vars.example` to `.dev.vars` and provide test GitHub App
credentials and separate random organizer/webhook secrets. Never use production secrets.
The browser keeps its organizer credential only in tab memory.

```sh
npm run check
npx playwright install chromium
npm run test:browser
REVIEW_URL=https://judge-c2c-review.dakshx.workers.dev npm run test:browser
```

Tests use signed adversarial fixtures and real local D1. No hostile code executes on
the developer host. Browser checks cover filtering, evidence navigation, mobile layout
and review write restrictions.

## Configure real GitHub intake

Register a GitHub App on selected hackathon repositories with **Metadata: read**,
**Contents: read**, **Pull requests: read**, **Checks: write**, and **Pull request** events.
Set webhook URL `/webhooks/github` and a strong secret. Production never uses a personal
access token. Convert GitHub's usual PKCS1 private key to PKCS8 for `GITHUB_APP_PRIVATE_KEY`:

```sh
openssl pkcs8 -topk8 -nocrypt -in github-app.private-key.pem -out github-app.pkcs8.pem
```

Adapt `examples/contract.json` with actual repository/installation IDs, full frozen SHA
and approved issues. Register outside participant repositories:

```sh
curl -X POST "$JUDGE_ORIGIN/api/contracts" \
  -H "Authorization: Bearer $JUDGE_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' --data-binary @challenge.json
curl -X POST "$JUDGE_ORIGIN/api/assignments" \
  -H "Authorization: Bearer $JUDGE_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"repositoryId":123,"prNumber":24,"teamId":"northstar","teamName":"Northstar","issueNumbers":[12]}'
```

Assignments cover the contract's entire issue set. There is one active challenge contract
per repository in this foundation; multiple simultaneous challenges are a follow-up.
Unassigned PRs fail explicitly instead of guessing a team or using participant judging
policy. Redeliver an event rejected before assignment registration.

`file_contains` is permitted for source/documentation criteria only. `runner` declares
a future isolated check and currently returns UNVERIFIED; `human` needs future audited
adjudication. AI cannot waive requirements, mint evidence or override objective failures.

## PR review and deployment

Work on a feature branch and PR; human decides merges. The current review Worker/database
are separate from production. `npm run deploy:review` updates the synthetic review.

GitHub Actions `Validate` runs types, tests, Worker build, dependency audit and browser
tests. `Cloudflare deployment` creates one Worker/Workflow per PR with no production
D1/R2/App/AI/admin bindings. Fork PRs receive credential-free CI. The exact PR commit must
be approved through a protected deployment environment before privileged deployment.

Activate automatic previews with GitHub environment `cloudflare-review` (required reviewer),
environment secret `CLOUDFLARE_API_TOKEN`, variables `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_WORKERS_SUBDOMAIN`, and repository variable `CLOUDFLARE_PREVIEWS_ENABLED=true`.
Use a **separate review Cloudflare account**: a build token generally has account-wide
Worker privileges, so application read-only mode alone cannot secure a token from
malicious PR code. The workflow tests the deployed URL and records it in the Actions
summary. Remove closed PR Workers/Workflows manually in this slice.

Alternatively authorize Cloudflare's GitHub App and configure native
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/). This PR uses
separate Workers rather than depending on beta Preview access.

Production remains disabled until `CLOUDFLARE_PRODUCTION_ENABLED=true`. It runs only on
human-merged main pushes through `cloudflare-production`, with its own token/account,
`PRODUCTION_DATABASE_ID`, `PRODUCTION_ARTIFACT_BUCKET`, `PUBLIC_ORIGIN` and account variable.
`scripts/production-config.mjs` rejects missing resources. Provision D1/R2, then Worker
secrets `ADMIN_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`.
R2 must first be enabled in the Cloudflare account dashboard.

Optional AI requires an AI binding and `AI_MODEL`; the selected model is
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, supporting
[JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/).

## API

All live organizer endpoints require `Authorization: Bearer <credential>` (at least
32 characters). There is one organizer role here; individual scoped identities remain
a production-readiness gate. `/health` is liveness, not a readiness attestation.

| Endpoint                          | Purpose                                                  |
| --------------------------------- | -------------------------------------------------------- |
| `GET /api/overview`               | Counts and latest 100 evaluations                        |
| `GET /api/repositories`           | Repositories and active contracts                        |
| `POST /api/contracts`             | Validate/store immutable contract and activate version   |
| `POST /api/assignments`           | Assign exact repository/PR/team/issues                   |
| `GET /api/evaluations/:id`        | Snapshots, report, evidence, timeline, artifact metadata |
| `POST /api/evaluations/:id/retry` | Redispatch or create a new failed-run attempt            |
| `GET /api/artifact?key=…`         | Authorized download with SHA-256 metadata                |

See [design](docs/design.md), [product baseline](docs/product-requirements.md),
[operations](docs/runbook.md), [runner boundary](docs/runner-boundary.md),
and [roadmap](docs/roadmap.md).
