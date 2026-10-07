# Actions VM / Gemini / Groq readiness checkpoint

2026-10-07. Public repository visibility was authorized and verified through authenticated gh. PR #12 is stacked on organization-onboarding PR #11; no merge or production deployment has occurred in this work.

## Delivered changes

- Container-free Actions adapter: bounded immutable D1 requests, separate runner App dispatch, exact workflow/commit identity checks, OIDC audience/issuer/signature/expiry validation, fenced claims, single-assignment results and supersession/timeout handling.
- QEMU guest runner: read-only frozen disk, independent guest kernel, nonroot commands, bounded tmpfs/process/CPU/memory/output/deadlines, restricted networking, host-side authoritative HTTP checks and fresh guest per command. Prepared image digest is part of the contract.
- Selectable Gemini and Groq adapters: private backend secrets, explicit model/depth routing, bounded JSON review, existing criterion/evidence/claim validation, reviewer leases and safe rate-limit handling. Production/workspace generator and private-file provisioning support both keys.
- Removed three ignored Finder .DS_Store files. Historical QA evidence, existing Docker fallback, dependencies required by the project and the owner's untracked screenshot were preserved. No acceptance ledger entry was upgraded from implementation alone.

## Proven so far

Local full checks passed all 530 tests, validated all 714 acceptance entries and built the Worker after the dependency update. Local and Cloudflare branch-preview browser suites each passed all 35 scenarios. Gemini/Groq fixture tests cover valid output, unknown citations, incomplete output, private key separation and rate-limit failure, but no live provider call has been established.

The first Linux VM preparation run exposed a missing Debian archive keyring on Ubuntu; the second exposed the host-dependent MODULES=dep initramfs mode. These failures are retained in CI. The builder now installs the signing keyring and explicitly lists guest modules. Dependency CI also identified the pre-existing sharp high-severity advisory; the override is updated to patched 0.35.5 and the refreshed root audit is clean. The first green VM CI status masked a failed assertion through tee; downloaded evidence exposed this. The wrapper now uses explicit Bash pipefail and stderr capture. The failed image is not a verified release. Final Linux run 37636409842 produced the actual successful synthetic record after the confirmed interface rename was fixed, guest readiness waits for the service port, and bounded entropy was supplied. Baseline FAIL, reference PASS and nonroot/read-only/credential-absence/metadata checks PASS are recorded in actions-vm-evidence.json. Quality CI run 37636409750 passed. No full adversarial or event-capacity claim follows from this canary.

## Required before the event

1. Approved merge of the stacked feature and default-branch dispatchable workflow. Feature branches are not production releases.
2. The bounded Linux guest smoke is proven. Release exactly those tested prepared image files, freeze the image identity, and deployment of the Actions configuration/migration to the separate production databases.
3. Separate runner GitHub App installation restricted to the public judge repository with Actions write/Contents read; provision only its backend credentials. Source/evaluation App installation and grants must also be verified for the actual event organization.
4. Secure location/provisioning of the owner's Gemini/Groq keys (not present in the inspected local env files or current production secret name list), explicit available model selection, and live reference/failure/protected-file calibration. Free provider throughput is not inferred from key possession.
5. Event contracts with authoritative checks for each actual repository/runtime, frozen baselines, all 80 team/member/issue assignments and webhook/status publication. The first VM profile is bounded Node, not arbitrary hackathon application support; offline dependency profiles are unavailable.
6. Deployed hostile-input/resource/escape/network/protocol drills and an 80-team simultaneous-submission rehearsal with queue/latency/provider budgets, outage recovery and retained history. A bounded synthetic smoke or browser fixture cannot certify these.

The existing production Docker/Cloudflare-AI configuration was not silently switched. Until the Actions setup and live provider calibration are verified, the new backend is implemented but not an activated live evaluation service.
