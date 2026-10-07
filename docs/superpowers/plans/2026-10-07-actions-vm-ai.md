# Actions VM and AI provider implementation plan

Goal: implement a selectable container-free runner and Gemini/Groq adapters without weakening evidence integrity.

1. Add provider transport tests for Gemini/Groq authentication, bounded errors, refusals/truncation, usage and existing judgment validation. Implement adapters in src/external-review.ts; update env, routing, reviewer capacity and production/workspace configuration. Run focused tests/typecheck.
2. Add Actions/OIDC tests for pinned repository/workflow identities, replay, expiry, supersession and result mismatch. Implement src/actions-runner.ts, migration, dispatch integration and authenticated broker routes. Existing runner result validator remains authoritative.
3. Add QEMU guest/host and trusted image preparation scripts, public Actions workflow and synthetic smoke. Ensure read-only guest disk, bounded tmpfs, no egress, nonroot participant code, fresh guest per operation and host-only assertions. Verify actual Linux execution through Actions.
4. Document secure key setup, public runner/App prerequisites, 80-team rehearsal and current limitations. Audit unused files while preserving history and owner work.
5. Run npm run check and npm run test:browser. Commit/push feature branch, create PR, inspect CI and Cloudflare preview, run preview browser verification, then report exact remaining setup and readiness gaps.

Execution is inline in this session under the owner's instruction to configure the agreed approach. No autonomous merge or production deployment.
