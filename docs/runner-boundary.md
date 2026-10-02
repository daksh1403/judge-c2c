# Isolated execution boundary

The runner adapter, authoritative policy schema, baseline/head pipeline and evidence
storage are implemented. **Cloudflare Containers deployment is disabled.** Cloudflare rejected
Containers provisioning on the current free Workers plan, and the owner explicitly
chose to keep it disabled. There is no RUNNER binding in ordinary local, preview or
review configuration. The owner subsequently authorized a development Docker runner through a tunnel; see
[local Docker runner](local-docker-runner.md). The backend is explicit, and contracts
pin its local image identity.
The microVM API, teardown and adversarial resource behavior still need deployed
validation before enabling real judging; platform mocks do not establish isolation.

## Supported first profile

`node-http-v1` supports small dependency-free Node repositories: at most 100 UTF-8
files, 100 KB per file and 750 KB total. Symlinks, submodules, truncated trees, binary
files and unavailable snapshots fail closed. Repository package installation is not
performed. More runtimes, prepared dependencies, real application compilation, full
security scans, coverage and benchmarks are future capabilities.

An organizer explicitly selects `payment-retry-v1` or registers another authoritative
policy through the protected contract API. The payment profile requires `server.mjs`
and tests four simulated payment outcomes over HTTP. It is a proposed test challenge,
not a requirement inferred from the current payment-engine issue. Its issue currently
contains only a test-label description. The current README-only PR cannot demonstrate
payment retry behavior. Arbitrary additional organizer criteria remain human/UNVERIFIED.

Functional PASS requires the trusted external HTTP assertion, not a participant's test
exit code. Supplemental commands include a Node syntax/build check, `node --test` and
prepared ESLint with fixed rules and repository/inline configuration disabled. A syntax
check is not a complete application build. Commands run as uid/gid 65534 with cleared
supplementary groups, no-new-privileges and dropped capabilities.

## Isolation and immutable inputs

Use Cloudflare's Durable Object Container API, which places each guest in a microVM.
The Worker/DO retains database, App and AI credentials. A guest receives only bounded
files from the exact commit and minimal runtime environment. It has no secrets, Git
credentials, cloud API tokens, application bindings or outbound Internet permission.
No public HTTP route forwards to the guest. The trusted DO calls only port 9000 and
validated relative test paths; tests/results are evaluated outside the guest.

Each baseline and head gets a fresh DO attempt. Acceptance boots from the original
snapshot before any repository command. The entire guest is destroyed after acceptance;
each supplemental command gets another clean guest and the original snapshot. Detached
processes and writable state cannot contaminate acceptance or subsequent commands.
No dependency or filesystem cache is shared between submissions.

Contracts freeze the immutable managed-registry image URI. `UNCONFIGURED` is permitted
only to describe disabled review setup; it cannot execute. Runtime image inspection
must match the contract and operator's allowed image. The supplied Dockerfile pins its
Node base by digest, freezes the Debian package catalogue, and installs prepared ESLint
using its own pinned lockfile. Never rebuild a tag and silently substitute it for a
historical contract image.

The supported fixed `lite` profile has 256 MiB total VM memory, 1/16 vCPU and 2 GB disk.
Contracts with a different memory policy are rejected. Process limits are 64 processes,
16 MiB per file, 20 CPU seconds and a 128 MiB V8 heap; the heap is not the total memory
limit. Each command has at most ten wall-clock seconds, and the contract's total timeout
is carried in the request/hash, enforced with a deadline, timer, inactivity timeout and
DO alarm. stdout/stderr capture is bounded to 8 KiB each; excess output kills execution.
Checks poll the current evaluation state between operations and terminate superseded
work. Finally blocks destroy guests, including after errors.

## Results and trust

Cloudflare's private binding RPC returns results to the workflow; there is no public
completion endpoint or guest-uploaded self-attestation. Validate exact request hash,
commit, contract hash, immutable image, tool-policy version, check IDs/kinds and exit
semantics before persisting. Baseline/head outputs are append-only D1 records with
SHA-256 integrity metadata, bounded redacted logs, timestamps, tool versions and duration.
A failed later stage cannot erase a successful earlier result. Overall report headlines
come from deterministic evidence policy; free-form model summaries cannot establish a
functional verdict. Requirement evidence
compares each trusted check against its baseline to distinguish new failures from
pre-existing behavior. AI cannot elevate unavailable execution into PASS or PARTIAL.

Completed invalid HTTP/JSON results are FAIL; unavailable transport or infrastructure
is UNVERIFIED. Raw participant responses are bounded and redacted. PASS confirms only
the exact defined cases, not general payment correctness or production readiness.

## Enabling later

Do not enable until an owner approves the paid infrastructure, the prepared image is
built and uploaded into the account registry with its digest, and deployed isolation
checks pass. Run `scripts/runner-config.mjs` only with explicit `JUDGE_RUNNER_ENABLE=true`
and `JUDGE_RUNNER_IMAGE=registry.cloudflare.com/...@sha256:...`. It generates an ignored
configuration for the **existing internal host**, with at most four instances and no
new public URL. It does not deploy. Ordinary deployments keep the runner disabled.

Required deployed adversarial drills: infinite loops, fork/process exhaustion, disk and
output exhaustion, install abuse, Internet/metadata/internal-network access, symlink
escape, secret theft, source-changing tests and spoof servers. Use only disposable
isolated infrastructure for hostile fixtures. Local adapter tests are mock-based and
never launch these workloads. Local Docker execution requires the explicitly selected development backend described
in the local runner guide; it does not replace production microVM readiness.

References: [sandbox isolation](https://developers.cloudflare.com/sandbox/concepts/security/),
[container API](https://developers.cloudflare.com/sandbox/get-started/),
[resource limits](https://developers.cloudflare.com/containers/platform/limits/).
