# Judge-C2C

GitHub engineering evaluation with immutable contracts, baseline comparison and
evidence-backed human review. AI interprets evidence; it does not establish facts.

**[Automatic PR Preview](https://feat-evaluation-foundation-judge-c2c.dakshx.workers.dev)** — test real public PRs in your own browser session.
This foundation is not ready to judge a real event.

## Try the real review flow

1. Open the existing bot-managed PR Preview above.
2. Paste a public GitHub PR URL and describe the expected behavior.
3. Optionally provide a frozen baseline SHA, a literal source assertion and protected paths.
4. Select **Evaluate PR**. Inspect exact commits, changed files, baseline-relative evidence,
   requirement assessments and the timeline. Download the complete review JSON.

For a small reproducible example, use `https://github.com/octocat/Hello-World/pull/1`,
expected behavior “Document the project greeting in README”, and a source assertion
for `README` containing `Hello World!`. This tests real GitHub reads, not runtime behavior.

The preview uses public GitHub APIs without credentials and never publishes to external
PRs. It persists each attempt in a separate review database. Your HttpOnly session lasts
24 hours; runs are retained for seven days and are visible only to that session. A new
Evaluate action captures a new head without overwriting earlier attempts. Without an
explicit baseline, it captures the PR merge base rather than an organizer-frozen baseline.
Public API rate limits and a 100-file diff limit can cause a review to fail explicitly.
Build/tests/benchmarks/security scans and AI review are not run here. Functional behavior
remains **UNVERIFIED**. Do not enter sensitive information into this review environment.

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
- Passing GitHub CI and native Cloudflare branch Previews that update on PR commits.
  Optional Actions deployment definitions remain disabled pending credentials/approval gates.

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

Open `http://localhost:8787`. Default mode supports the isolated public PR review workspace. Set `PREVIEW_TESTING=false`
to use the synthetic read-only fixtures.
For local live mode, copy `.dev.vars.example` to `.dev.vars` and provide test GitHub App
credentials and separate random organizer/webhook secrets; set `PREVIEW_TESTING=false`. Never use production secrets.
The browser keeps its organizer credential only in tab memory.

```sh
npm run check
npx playwright install chromium
npm run test:browser
REVIEW_URL=https://feat-evaluation-foundation-judge-c2c.dakshx.workers.dev npm run test:browser
```

Tests use signed adversarial fixtures and real local D1. No hostile code executes on
the developer host. Browser checks cover filtering, evidence navigation, mobile layout
public review submission/polling/download, escaping hostile patches, and privileged write restrictions.
The browser fixtures do not claim to exercise GitHub; a deployed real public PR smoke check
is performed separately.

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

Work on a feature branch and update the existing PR; the human decides merges. The
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) connection
automatically updates the existing branch Preview on commits. Do not provision a new
public Worker for each change. GitHub Actions `Validate` runs types, tests, Worker build,
dependency audit and browser tests. Fork PRs receive credential-free CI.

Root and `previews` bind only the separate **review** D1 database and the existing
`judge-c2c-public-preview-evaluator` Workflow hosted by `judge-c2c-review`. That internal
Worker has its public workers.dev and version preview routes disabled. Cloudflare
[preview Workflows](https://developers.cloudflare.com/workers/previews/resources/) run
the code of the deployed Workflow host, not the application branch Preview. When changing
its stages, first migrate review D1 and run `npm run deploy:review` to update this existing
internal host, then push the PR. Changes shared by several simultaneous branch previews
would require versioned Workflow hosts; this slice serves the current coherent PR.
No production resources, GitHub App secrets or AI credentials are bound to this workspace.
The preview uses real public repository data; it is not a live hackathon evaluation.

The parent `judge-c2c` production route stays disabled. Optional Actions deployment
workflows remain disabled and require scoped credentials and a supported approval gate.
GitHub rejected required-reviewer environment protection on the current billing plan.
Never put production judging credentials in the native preview parent/base configuration.

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
