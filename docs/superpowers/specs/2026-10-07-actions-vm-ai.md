# Public Actions VM execution and Gemini/Groq

Owner requested a container-free execution backend for approximately 80 public teams, Gemini/Groq configuration, conservative cleanup and an honest readiness report.

Use a dedicated public organizer-controlled runner repository. Dispatch fixed trusted workflow code through a separate least-privilege GitHub App. Cloudflare holds immutable bounded requests; GitHub OIDC authenticates claims/results against repository ID, exact workflow path/ref/SHA, audience and run identity. Each dispatch creates a new attempt. Expired and superseded work cannot become successful current evidence.

QEMU runs participant Node code in a fresh read-only prepared Linux guest per service/command. No host mounts, credentials or outbound networking enter the guest. Host HTTP assertions establish functional results. Guest command results are supplemental. Pinned kernel/rootfs/agent digests identify the execution environment. Unsupported dependencies remain UNVERIFIED. Never run participant code directly in the Actions host.

Gemini and Groq use fixed HTTPS origins, bounded calls and output, no tools, backend-only keys, explicit model/provider provenance and existing strict evidence validation. Selection is explicit; no hidden fallback. Review deployments remain credential-free synthetic fixtures.

Preserve contracts, historical QA evidence, existing Docker backend and untracked owner files. Cleanup requires demonstrable redundancy. No main merge, visibility change or live event-readiness claim is authorized. Event readiness requires actual deployed guest isolation tests, provider calibration and an 80-team burst rehearsal.
