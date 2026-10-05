# Connect the event GitHub organization and retire the rehearsal connection

## User outcome

The current GitHub organization is private rehearsal infrastructure. On event day, the owner must be able to connect a different GitHub organization they administer. Once that new connection is verified, the old private organization must be removed from active use. No old participant, contract, credential or evaluation data may appear in the event workspace.

## Chosen approach

Use a fresh independent event workspace, following the application's existing one-organization-per-deployment isolation model. Provide guided setup for an arbitrary valid GitHub organization, rather than requiring edits to source code or hardcoded Daksh-Codebase settings. The normal GitHub App registration and installation steps remain in the organizer frontend. A shared database with organization switching is outside this change.

The setup command accepts the organization name and a unique workspace name, verifies the authenticated GitHub actor administers that organization, and validates runner/provider/deployment inputs. It presents a concrete plan before provisioning. Explicit provisioning creates fresh Worker/Workflow names, evaluation and organization databases, artifact storage and organizer/judge/security/vault credentials. It never copies resources, credentials or rows from the private rehearsal deployment. The current fixed production profile remains compatible.

No event organization has been named yet. Implement and verify the reusable setup flow now; do not invent an organization, change the live private installation, or provision event resources until the actual organization is supplied.

## Setup and activation flow

1. Run the guided organization setup with the event organization's name. Validate GitHub admin membership and the account configuration before any remote mutation. Plan mode performs reads only.
2. Provision a new workspace using unique names and empty resources. Persist an ignored private setup journal so partial failures can be resumed without deleting resources or regenerating credentials. All secrets go through stdin or private files, never arguments, logs, JSON configuration, previews or git.
3. Deploy the approved runtime to the new workspace with that exact organization identity and origin. Open the organizer console; register its least-privilege organization-owned App and install it for the selected event repositories. Do not copy the current App key.
4. Verify the installation's organization, selected repositories, required permissions, organizer authentication and signed runner availability. An unavailable AI provider remains explicit and cannot be hidden by a successful connection. Connecting an App is not event-capacity certification.
5. Only after the new workspace is verified, disconnect the old App installation, stop active evaluation intake for that workspace and remove the old organization from the active setup selection. Require the exact old organization name to prevent retiring the new target by mistake.
6. Retain the old encrypted credentials, contracts, failed/superseded attempts and judge history in a restricted archive. Disconnecting GitHub access removes active use; it does not purge immutable evaluation history. The event console operates only on the fresh event resources.

## Boundaries and failure handling

GitHub App installation callbacks continue enforcing the configured organization identity. Never accept an arbitrary callback organization into an existing populated workspace. Resource names, organization names and origins are validated before running commands. Existing/review/production resource identifiers cannot be reused for a new event workspace. Do not grant the deployment token or privileged GitHub tools to participant code, AI or browser scripts.

Setup failures preserve the journal and report the failed stage without pretending the workspace is connected. The old organization stays active until the new connection passes verification. Retirement failures leave visible pending status and allow a safe retry; archive history is preserved throughout. Setup does not merge a PR, activate paid billing or disable environment protection.

## Implementation scope

- Generalize the production configuration generator to validated workspace-specific Worker/Workflow/resource names and output paths while preserving current defaults and denying preview/native-parent collisions.
- Add guided organization provisioning and validation commands, private journal handling and documented inputs. Use authenticated gh/gh api for live GitHub identity and membership checks and Wrangler for Cloudflare operations.
- Add organizer-authorized disconnect/retirement handling with exact organization confirmation, retained history and explicit intake fencing. The existing frontend should explain the configured organization and how to connect the event workspace without displaying secrets or suggesting unsupported shared tenancy.
- Document the complete private-to-event transition and the remaining provider/capacity gates.

## Verification and delivery

Meaningful tests cover arbitrary valid organizations, invalid inputs, non-admin rejection before writes, unique fresh resources, refusal to reuse the current/review resources, secret redaction, resumable failure stages, callback identity enforcement and organizer-only retirement that preserves evaluation history. Existing two-isolate organization isolation tests remain authoritative for local boundaries. Browser tests cover connection/retirement states and denied participant/judge actions.

Run npm run check and npm run test:browser. Publish the feature branch and PR, verify its pushed commit, CI and bot-provided isolated Cloudflare preview, then exercise the relevant preview UI. Never attach production resources or secrets to the preview. A second real organization integration remains unverified until an actual event organization and owner installation are available. No automatic merge or feature deployment to production.
