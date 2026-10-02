# Development Docker runner through Cloudflare Tunnel

The organizer can explicitly use their own Docker system for review testing. The
application retains its existing Cloudflare preview URL. A temporary backend tunnel
connects the internal Worker to an authenticated service listening only on
`127.0.0.1:8790`. The Docker API itself is never exposed.

## Start and connect

With Docker and `cloudflared` installed and Docker running, from the repository:

```sh
npm run runner:build
npm run runner:start
```

Keep that terminal open. Once it reports the tunnel ready, in another terminal:

```sh
npm run runner:smoke
npm run runner:connect
```

The smoke sends an absent baseline and the organizer-authored reference service
through the real tunnel. It expects four acceptance FAIL results then four PASS
results. It is a synthetic fixture, not a participant evaluation. Results are saved
in the ignored `.wrangler/local-runner-smoke.json`.

The connection deploys only the existing internal review host with its isolated test
bindings. It does not provision Cloudflare Containers, enable production, or create a
new website. Select the trusted payment-retry profile when registering a compatible
assigned PR. The contract freezes the exact local Docker image ID; old contracts with
`UNCONFIGURED` must not be edited or silently upgraded. Register a new assignment
version instead. The current README-only payment PR does not demonstrate retry logic.

The tunnel URL changes on restart. Repeat `runner:connect` after restarting; the website
URL stays unchanged. If the machine sleeps, Docker stops or the tunnel is unavailable,
checks remain UNVERIFIED. The status panel reports configuration, not a health guarantee.
Quick Tunnels are temporary development services, not a production uptime solution.

## Security boundary

Only HMAC-authenticated POST jobs execute. A short timestamp window and single-use
nonce reject replay; the exact body is authenticated before parsing. Results are
signed and bound to the request hash and nonce, then validated against immutable
commit, contract, image and check IDs. Local secrets are generated with restrictive
permissions in ignored `.wrangler` files and installed only on the internal host.
Neither browser code nor execution containers receive them.

The service runs one job at a time. Containers have network `none`, a read-only root,
no host bind mounts, no Docker socket, all capabilities dropped, no-new-privileges,
nonroot users, default seccomp, 256 MiB memory with no extra swap, 0.5 CPU, 64 PIDs,
limited open files and bounded `/work` and `/tmp` tmpfs storage. Source files arrive
through trusted stdin initialization. Repository dependency installation is disabled.

Trusted HTTP probes use the prepared read-only Node runtime under a different UID
and never import repository code. Acceptance runs before supplemental commands;
each command receives a new container with the original snapshot. Logs and request
sizes are bounded. The contract's wall-clock deadline kills and removes active guests.
Removal must be confirmed before a result can succeed; failed identities are retained
for retries. Graceful shutdown removes active guests. A host or daemon crash can leave
orphaned containers; inspect containers labeled `judge-c2c.local-runner=1` before
restarting after a crash, and remove only those owned by this development runner.

Docker containers share the Docker VM kernel. These settings reduce exposure but do
not establish the same boundary as per-submission microVMs. This is an explicitly
selected development runner on the owner's machine, not production hackathon sandbox
readiness. Do not enable it on machines with unrelated sensitive container workloads.
Full escape/resource adversarial testing still belongs on disposable infrastructure.

## Stop

Press Ctrl-C in the runner terminal. To disconnect the application, use the ordinary
`npm run deploy:review`, whose checked-in configuration keeps execution disabled.
No saved evaluation or contract is rewritten when the runner is disconnected.

References: [Docker Engine security](https://docs.docker.com/engine/security/),
[Quick Tunnel limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
