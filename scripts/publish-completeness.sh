#!/usr/bin/env bash
# Run from an authenticated terminal with network and Git metadata access.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(git branch --show-current)" != "feat/evaluation-completeness" ]]; then
  echo "Expected feat/evaluation-completeness; no changes published." >&2
  exit 1
fi
if ! git diff --cached --quiet; then
  echo "Existing staged changes require review; nothing published." >&2
  exit 1
fi
remote=$(git remote get-url origin)
case "$remote" in
  https://github.com/daksh1403/judge-c2c|https://github.com/daksh1403/judge-c2c.git|git@github.com:daksh1403/judge-c2c.git) ;;
  *) echo "Unexpected origin; no changes published." >&2; exit 1 ;;
esac
push_urls=$(git remote get-url --push --all origin)
while IFS= read -r push_url; do
  case "$push_url" in
    https://github.com/daksh1403/judge-c2c|https://github.com/daksh1403/judge-c2c.git|git@github.com:daksh1403/judge-c2c.git) ;;
    *) echo "Unexpected push destination; nothing published." >&2; exit 1 ;;
  esac
done <<< "$push_urls"
gh api user --jq .login
base=$(gh repo view daksh1403/judge-c2c --json defaultBranchRef --jq .defaultBranchRef.name)
existing=$(gh api 'repos/daksh1403/judge-c2c/pulls?state=open&head=daksh1403:feat/evaluation-completeness' --jq '
  if length > 1 then error("Ambiguous existing PRs; nothing published")
  elif length == 1 then
    if .[0].head.repo.full_name == "daksh1403/judge-c2c" and .[0].head.ref == "feat/evaluation-completeness"
    then [.[0].number,.[0].base.ref] | @tsv else error("Existing PR head mismatch; nothing published") end
  else empty end')
pr=""
if [[ -n "$existing" ]]; then
  IFS=$'\t' read -r pr pr_base <<< "$existing"
  if [[ "$pr_base" != "$base" ]]; then
    echo "Existing PR base mismatch; nothing published." >&2
    exit 1
  fi
fi
git fetch origin
# Explicit implementation paths exclude local credentials, .wrangler and .DS_Store.
git add -- docs/master-acceptance.json docs/master-acceptance.md docs/completeness-contracts.md docs/completion-plan.md \
  docs/qa/completeness-progress.md docs/qa/orchestrated-dashboard-matrix.json docs/qa/orchestrated-infra-validation.json \
  docs/qa/orchestrated-participant-matrix.json docs/qa/orchestrated-validation-report.md docs/qa/validation-shards.json \
  docs/qa/completeness-pr.md docs/qa/completeness-review-guide.md docs/qa/zero-gap-progress.md docs/remaining-work.md docs/qa/current-validation.json docs/qa/current-review-runtime.json docs/qa/readiness-live-access.json \
  wrangler.jsonc public/competition.js public/organization.js public/style.css scripts/acceptance-report.mjs scripts/publish-completeness.sh \
  src/api.ts src/competition-issues.ts src/competition.ts src/env.ts src/organization.ts src/runner-policy.ts src/runner.ts \
  src/security.ts src/source-security.ts src/workflow.ts src/additional-contributions.ts src/artifact-store.ts \
  src/evaluation-metrics.ts src/execution-cache.ts src/requirement-assessment.ts src/secret-scanner.ts \
  src/claim-grounding.ts src/evaluation-plan.ts src/expected-artifacts.ts src/operational-telemetry.ts src/submission-relations.ts src/review-routing.ts \
  src/index.ts src/domain.ts src/evaluate.ts src/github.ts src/competition-store.ts src/competition-overview.ts src/competition-completion.ts \
  migrations/0011_execution_cache.sql migrations/0012_artifact_store.sql migrations/0013_additional_contributions.sql \
  migrations/0014_operational_telemetry.sql migrations/0015_submission_relations.sql \
  tests/browser/dashboard.spec.ts tests/database.ts tests/additional-contributions.test.ts tests/artifact-store.test.ts \
  tests/execution-cache-sqlite.test.ts tests/execution-cache.test.ts tests/requirement-assessment.test.ts \
  tests/claim-grounding.test.ts tests/evaluation-plan.test.ts tests/expected-artifacts.test.ts tests/operational-telemetry.test.ts tests/submission-relations.test.ts tests/review-routing.test.ts \
  tests/reservation-lifecycle.test.ts tests/secret-scanner.test.ts tests/security.test.ts tests/source-security.test.ts
git diff --cached --check
if ! git diff --cached --quiet; then
  git commit -m "Ground judge narratives and complete review controls"
fi
# Never force-push or merge. A divergent remote branch must be resolved separately.
git push -u origin feat/evaluation-completeness
if [[ -n "$pr" ]]; then
  gh pr edit "$pr" --repo daksh1403/judge-c2c --title "Ground judge narratives and add review controls" --body-file docs/qa/completeness-pr.md
else
  gh pr create --repo daksh1403/judge-c2c --base "$base" --head feat/evaluation-completeness \
    --title "Ground judge narratives and add review controls" --body-file docs/qa/completeness-pr.md
fi
gh pr view feat/evaluation-completeness --repo daksh1403/judge-c2c --json url,headRefOid,statusCheckRollup
