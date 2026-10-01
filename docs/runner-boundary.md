# Isolated execution boundary

This describes the next implementation slice; it is not an implemented sandbox.
The Worker currently sends no execution requests. Runner criteria stay UNVERIFIED.

Use disposable microVMs or equivalently audited isolation on a dedicated execution
account/network. Plain shared-host Docker is insufficient for hostile code. Hosts and
guests carry no production App, AI, database or Cloudflare credentials. Keep the trusted
artifact broker outside guests. Mount exact commit archives and organizer test bundles.

Requests bind run/repository identity, exact baseline/head, contract hash, trusted check
ID, immutable image digest, authoritative argv and timeout/CPU/memory/PID/disk/output/
artifact/network limits. Code cannot alter these. Baseline and submission run in separate
clean guests with identical policy/images. Dependency preparation is a separately isolated
workload with allowlisted egress, no private/metadata destinations, locked dependencies
and no shared writable caches. Participant install scripts remain hostile workloads.

Results bind the request digest, run/check/commit, environment/tool versions, timestamps,
exit/resource/timeout status, bounded stdout/stderr, normalized findings and hashed artifacts.
Trusted acceptance tests establish challenge behavior; repository tests are supplemental
and compared for manipulation. Sign results outside guests; validate semantics and hashes
at the broker. A participant cannot attest its own test success.

Internal completion requires authenticated transport and replay-safe identity validation.
Reject commit/config mismatch. Cancellation terminates the guest and prevents later results
from changing superseded history. Compare baseline/head results to attribute regressions.
Only contract-authorized checks can establish functional criteria. Unavailable never means PASS.

Validate infinite loops, process bombs, disk/output exhaustion, install abuse, network and
metadata access, symlink escape, secret theft and malicious reports using disposable
dedicated infrastructure. Never run hostile fixtures on the developer host or app Worker.
