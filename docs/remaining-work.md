# Current remaining work

Affected workstream bookkeeping; requirements and acceptance criteria are unchanged.

| Status         | Items |
| -------------- | ----: |
| PASS           |   699 |
| BLOCKED        |     9 |
| PARTIAL        |     4 |
| NOT_APPLICABLE |     2 |

Original three-submission calibration and reviewer diagnostic now pass through actual PR #7 frontend actions under policy v14. Production remains unauthorized. No statuses were upgraded for implementation alone.

## 01. Project foundation & development workflow

- **01.12 — Local preview production separation (PARTIAL)**: Exact production domain routing and isolation guards pass targeted tests. Actual cloudflare-production environment, inputs/resources/secrets/domain and deployed separation remain absent or unverified; merge alone is insufficient.

## 03. GitHub integration

- **03.03 — Least privilege (PARTIAL)**: Evaluation tokens are repository-scoped/downscoped, but the actual review App grants excess PR/hooks/workflows write permissions and selects all repositories. Owner permission reduction and separate production installation remain required.

## 36. Async processing queueing

- **36.10 — Horizontal capacity (PARTIAL)**: 24 contenders across two real local Worker isolates with shared D1 passed crash fencing/backoff/supersession/recovery tests. Deployed multi-host event capacity and provider budget remain unverified.

## 45. Persistent data model

- **45.01 — Organizations (PARTIAL)**: Existing isolated review organization and one real GitHub team verified through frontend. Multiple independent organizations/events and their deployment isolation remain unproven.
