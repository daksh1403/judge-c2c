# Foundation implementation plan

Goal: deliver an inspectable GitHub-to-evidence vertical slice and a real Cloudflare
review application on a PR branch.

- [ ] Establish Worker, D1 migration, immutable domain schemas, and contract tests.
- [ ] Implement signed webhook intake, repository/assignment allowlists, delivery
      deduplication, transactional outbox and supersession; test replay and races.
- [ ] Implement GitHub App authentication, bounded exact-commit comparison, objective
      source checks, baseline attribution, optional validated AI reasoning and publication.
- [ ] Implement durable stages, retry reconciliation, protected APIs, artifacts and
      useful judge views. Preserve partial evidence when a stage fails.
- [ ] Add CI, isolated Cloudflare review deployment and deployment/runbook documentation.
- [ ] Validate type safety, tests, SQL integration, local HTTP and deployed HTTP.
- [ ] Commit, push, open PR, inspect checks and preview, leave unmerged for review.

Implementation is performed inline. The complete product specification is the
authority; this plan scopes the first coherent PR and never claims the later
execution fleet or production judging system already exists.
