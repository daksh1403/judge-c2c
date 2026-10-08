# Doom-Forge event activation

The owner selected **Doom-Forge** as the sole active event organization. Its GitHub ID is `339267430`. Authenticated inspection confirmed `daksh1403` has active owner/admin membership and access to `Doom-Forge/Bot-Backend` (ID `1409179117`). That repository remains private. Access does not establish judging criteria or assignments.

## Prepared deployment

Use workspace `doom-forge` and origin `https://judge-c2c-doom-forge.dakshx.workers.dev`. The existing generator gives it a separate Worker, two Workflows, two empty D1 databases and artifact KV namespace. Select `--artifact-storage kv`: R2 is not enabled on the account. KV retains its platform size and quota limits.

Select `--runner-mode ACTIONS_VM`, public runner repository `daksh1403/judge-c2c` (ID `1400414482`), and image `qemu-vm@sha256:bffe6808899f23b08694a4d8e367ddcdc411856ca87135f3d2c5f67b44819e71`. All assets for tested release `vm-node-v1-20261007` are uploaded, but it remains a draft. A real runner App installation ID and approved default-branch workflow SHA are required before provisioning. Never invent IDs or silently treat a feature workflow as the live release.

Gemini `gemini-3.1-flash-lite` passed connectivity and three actual provider reviews of source-only synthetic cases. Groq `openai/gpt-oss-120b` passed connectivity and two cases; its protected-file case failed and is retained. Both keys are in ignored private storage and installed on the existing production Worker. The new workspace must receive explicitly supplied provider credentials through its private setup path. Previews remain credential-free. Gemini is the prepared default, without hidden fallback.

## Ordered tasks

1. Complete workspace code, full checks, PR CI and credential-free Cloudflare review. This prepares the interface, not a live organization connection.
2. Register the Doom-Forge evaluation App with Contents/PR read and Issues/Checks write. Register a separate runner App restricted to Actions write/Contents read on the runner repository. Verify actual ownership, permissions, IDs and selected repositories; store keys only in the backend.
3. Obtain explicit approval for stacked PR #11/#12 merges and production deployment. Publish the tested image and pin the approved main workflow SHA.
4. Provision the fresh Doom-Forge workspace using Actions, KV artifacts, the real runner installation and selected provider. Apply all migrations to both new databases, install secrets and deploy approved main code.
5. Register/install the evaluation App through the new workspace. Verify repository reads, signed webhooks, Actions OIDC execution, reviewer output and frontend evidence. Missing behavior remains UNVERIFIED.
6. Retire previous live event workspaces using a freshly verified replacement receipt. Remove their App installations, fence intake and retain immutable history as a read-only archive. Historical evidence must not be rewritten to claim it ran on Doom-Forge.
7. Register the actual 80 teams/members/repositories, issue criteria, frozen baselines and assignments. Exercise a real participant PR and hostile-workload/capacity/recovery rehearsals before declaring event readiness.

The previous Daksh-Codebase production connection remains active until replacement verification and retirement succeed. Local example configuration names Doom-Forge; a prepared configuration is not a completed live switch.
