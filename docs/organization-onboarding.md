# Prepare a fresh GitHub organization workspace

Each deployment owns one organization, two empty databases, isolated artifact storage, independent App registration and fresh credentials. The selected event organization is now [Doom-Forge](doom-forge-activation.md). Live replacement setup remains pending; historical rehearsal connections are not Doom-Forge evaluation evidence.

Use Node 22.12 or newer and `npm ci`. The CLI invokes the installed, pinned Wrangler version and authenticated `gh` / `gh api`. Authenticate `gh` as an active administrator of the actual event organization. Provide `CLOUDFLARE_ACCOUNT_ID` and a privately supplied `CLOUDFLARE_API_TOKEN` with read access to Workers, Workflows, D1, KV and R2; provisioning additionally requires resource write/migration/secret permissions. Planning requires all inventories to be readable and refuses incomplete or unavailable evidence. It does not enable billing or modify GitHub environments.

Supply the actual values through flags or these non-secret environment settings:

- `PUBLIC_ORIGIN`: an independent HTTPS custom domain.
- `PRODUCTION_RUNNER_ENDPOINT`: an isolated HTTPS runner origin.
- `PRODUCTION_RUNNER_IMAGE`: a digest-pinned `registry.cloudflare.com/...@sha256:...` image.
- `PRODUCTION_AI_PROVIDER`: `cloudflare`, `callmissed`, `gemini` or `groq`.
- `PRODUCTION_AI_MODEL`: the selected provider model identifier.

The optional `OWNER_TUNNEL` mode requires a digest-pinned `docker-local@sha256:...` image and an exact HTTPS `*.trycloudflare.com` runner origin. `--runner-mode OWNER_TUNNEL` (or `PRODUCTION_RUNNER_MODE`) selects it. This mode also permits the exact `https://judge-c2c-WORKSPACE.SUBDOMAIN.workers.dev` origin when `--workers-subdomain` (or `CLOUDFLARE_WORKERS_SUBDOMAIN`) matches the account subdomain. A native, review, current production, foreign-account or preview Worker hostname is refused.

`--runner-mode ACTIONS_VM` uses a digest-pinned `qemu-vm@sha256:...` image without a runner endpoint. Supply `--runner-repository`, `--runner-repository-id`, `--runner-ref`, `--runner-sha` and `--runner-installation-id` (or corresponding `PRODUCTION_RUNNER_*` inputs). The exact isolated workspace Workers.dev origin is supported with `--workers-subdomain`. Provision `RUNNER_APP_ID` and `RUNNER_APP_PRIVATE_KEY` separately on the backend; this profile generates no tunnel secret. See [Actions VM setup](actions-vm-runner.md).

`--artifact-storage kv` (or `PRODUCTION_ARTIFACT_STORAGE=kv`) selects the existing KV artifact adapter for Actions/owner profiles. It excludes R2 inventory, provisioning and bindings while retaining other inventory/isolation checks. Default `r2` and managed profiles still require R2. KV has platform size/quota limits.

## Plan and provision

Set `EVENT_ORGANIZATION` and `EVENT_WORKSPACE` to the actual organization and a unique lowercase workspace name. Workspace names use single hyphens, begin with a letter and contain at most 30 characters. Production, local, review, preview, feat and test segments are reserved. GitHub organization names use their real GitHub format, including the 39-character limit.

```sh
npm run organization:setup -- --organization "$EVENT_ORGANIZATION" --workspace "$EVENT_WORKSPACE"
```

The default is read-only planning. It validates every input, checks GitHub identity and active admin membership, inspects current/native/review identifiers only to deny reuse, and checks the authenticated Cloudflare account inventory. The output shows exact intended names and runner/provider settings without resource IDs or credentials. A workspace has a unique Worker, two Workflows, evaluation and organization databases, KV namespace and R2 bucket. No configuration, journal or cloud resource is written by planning.

Review that plan, then explicitly provision:

```sh
npm run organization:setup -- --organization "$EVENT_ORGANIZATION" --workspace "$EVENT_WORKSPACE" --apply
```

Provisioning creates fresh D1, KV and R2 resources, applies migrations separately to `DB` and `ORG_DB`, and generates independent organizer, judge, security, vault, evaluation-admin and runner signing credentials. Wrangler receives secrets only through stdin. It creates an empty Worker shell to store these secrets; application code and Workflow deployment require the separate deployment flag below. No rehearsal App key, database rows, binding or ambient application secret is copied.

For Callmissed, explicitly supply a fresh provider credential with `--provider-key-file /absolute/private/provider-key`. The CLI requires a regular mode-0600 file and does not inherit `CALLMISSED_API_KEY` from the environment. The value is retained privately for resumable setup. Cloudflare AI uses its own binding.

The ignored directory `.wrangler/workspaces/WORKSPACE/` is mode 0700. Its `journal.json` and `config.json` are mode 0600 and contain private resource IDs and credentials. The current `.wrangler/production.json` is not overwritten. Relative source, assets and migration paths resolve from the nested config to this repository. Do not commit or share this directory. An operator with filesystem access can retrieve organizer credentials there and configure the isolated runner with that workspace's fresh `RUNNER_TUNNEL_KEY`; the CLI never prints credential values.

Rerun the same command to resume after a migration or later-stage failure. Completed resources, credentials and stages are retained and their identities rechecked. The target organization, account, origin, runner and provider cannot be changed in an existing journal. Choose a fresh workspace name for a different target. A failure during resource creation retains an ambiguous pending stage and refuses automatic adoption; inspect the remote resource and private journal before recovery. A stale `setup.lock` similarly requires checking that the prior operator process has stopped. Never delete a database merely to retry setup, or adopt a resource that was not positively created by this setup.

## Deploy approved runtime

Explicit runtime deployment requires both `--apply --deploy` and a clean `main` checkout whose exact commit matches a freshly fetched `origin/main`. The CLI refuses feature branch deployment. Review and owner authorization of runtime source must precede its inclusion on main; the setup command does not merge or approve source. A separate approved checkout can reuse the private workspace directory on the operator machine.

```sh
npm run organization:setup -- --organization "$EVENT_ORGANIZATION" --workspace "$EVENT_WORKSPACE" --apply --deploy
```

Workflows are created by that runtime deployment. Open the new organizer console, authenticate with its own organizer credential, register an organization-owned App and install it on the selected event repositories. Registration and callbacks keep the existing exact configured organization checks. Use the new App's generated key; never copy the rehearsal key.

## Verify the replacement

Use the same settings and the exact App slug, numeric App ID and installation ID from the new registration/install flow. Include at least one `--repository ORGANIZATION/NAME`; repeat it for every repository whose access must be verified.

```sh
npm run organization:verify -- --organization "$EVENT_ORGANIZATION" --workspace "$EVENT_WORKSPACE" --app-slug "$EVENT_APP_SLUG" --app-id "$EVENT_APP_ID" --installation-id "$EVENT_INSTALLATION_ID" --repository "$EVENT_ORGANIZATION/$EVENT_REPOSITORY"
```

Verification authenticates to the exact workspace origin using only its private organizer token and refuses redirects. It correlates authenticated status against GitHub's real organization installation inventory and App metadata obtained with `gh api`. It requires organization ownership, the expected App and installation, no suspension, and exactly the required `contents:read`, `pull_requests:read`, `issues:write` and `checks:write` permissions (optional `metadata:read`). It performs the workspace's installation-authenticated repository sync, then checks selected repository access and organization ownership. Repository inspection therefore uses the new App's credentials without requiring a GitHub App user token in `gh`.

The organizer runner diagnostic must complete its synthetic baseline FAIL and submission PASS canaries. The Worker verifies runner HMAC signatures or exact pinned Actions OIDC identity before accepting results. The operator permits up to 30 minutes for the two bounded Actions jobs; ordinary API calls retain shorter timeouts. This proves signed transport availability for those canaries, not participant functional criteria or event throughput. Reviewer diagnostics report provider availability separately; failure remains `UNAVAILABLE` and cannot fabricate functional evaluation evidence.

A private, bounded verification record binds organization, workspace, account/resource target hash, origin, App, installation and repository names to a 15-minute validity window. A failed or interrupted verification replaces any previous success with PENDING or FAILED. Output always reports `functionalEvaluation: UNVERIFIED`. Provider success and signed canary availability do not certify live hackathon capacity. The later retirement flow must reverify this exact replacement before acting on the old workspace.

Keep the rehearsal connection active until replacement verification and an explicit authorized retirement complete. This setup command does not retire an organization.

## Retire the old workspace after replacement verification

The authenticated organizer console names the configured organization and offers its GitHub App registration flow. A replacement uses its own deployment and App; it never imports old repositories, teams, credentials or judging history.

The verification command above prints a credential-free connection receipt. In the old organizer console, paste that JSON receipt into **Retire this workspace**, review the replacement organization and HTTPS origin, type the old organization name exactly, and acknowledge that you verified the replacement and authorize installation removal. Never paste the private `journal.json` or deployment configuration. The console rejects unknown receipt fields and expired verification. The acknowledgement records organizer authorization; it is not independent proof of resource isolation or participant functional behavior.

For the stronger operator path, use the private replacement journal and read-only old deployment config to verify resource separation and reverify the replacement before contacting the old console:

```sh
npm run organization:retire -- --journal /absolute/private/replacement/journal.json --old-origin https://old.example.org --old-token-file /absolute/private/old-organizer-token --old-config /absolute/private/old-config.json --confirm-organization Exact-Old-Organization
```

The token file and old config must be regular mode-0600 files. The command refuses shared Worker, Workflow, database and artifact identities before sending workspace credentials. Retirement is a separate explicit operation; do not combine it with provisioning, deployment or verification flags.

Once authorized, the old workspace enters RETIRING and fences new intake, mutations, retries and execution. An unavailable uninstall remains pending; the organizer console offers **Retry installation removal** using the same frozen replacement identity and retains the fence. A 202 uninstall response does not establish completion: RETIRED requires authoritative confirmation that the old installation is absent. Historical evaluation inputs, failed/superseded attempts, evidence and artifacts remain read-only. Organizers see the exact replacement link; other roles receive the read-only archive without retirement controls or replacement authorization details. Existing work already in flight cannot be recalled retroactively. Synthetic verification does not certify live event capacity or participant functional criteria.
