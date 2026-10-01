# Judge-C2C foundation

The control plane is one TypeScript Cloudflare Worker. D1 owns contracts, assignments,
deliveries, submissions, immutable run snapshots and stage results. Workflows own
retries and durable steps; a scheduled outbox reconciliation repairs the gap between
database commit and workflow creation. R2 stores bounded evidence artifacts.
The browser receives neither GitHub nor AI credentials.

The first useful slice compares a frozen baseline with an exact PR head using a
GitHub App, records deterministic diff/policy checks and source assertions, and
offers optional Workers AI requirement reasoning. Functional requirements remain
UNVERIFIED without execution evidence. Source assertions can confirm only explicit
source/documentation criteria. No score is assigned. AI can never upgrade an
objective failure, claim confirmed evidence, invent criteria, or mint evidence IDs.

Authoritative contracts and team/PR assignments are registered through an
authenticated administrative API, outside participant repositories. Each run
snapshots the contract and assignment. Configuration changes get distinct hashes.
Each assignment pins its contract hash, so multiple PR challenges in one repository
remain independent. Core administrative APIs require a bearer credential. The
organization console uses expiring HttpOnly organizer sessions and same-origin
mutations. Public reviews use a separate browser-session scope and database.
Neither workspace receives production bindings.

Participant execution is a separate boundary, not a shell in the Worker. This PR
does not deploy an execution fleet. It publishes a precise runner protocol and
deployment requirements; missing runner evidence is visible. Hostile repository
contents and logs are data. No AI tools or repository-specified commands execute.

Alternative considered: a monolithic VM would simplify execution but join secrets
and hostile code; a microservice fleet would add operational burden before the loop
works. Workers plus a later separately provisioned microVM runner is the smallest
robust control plane.

Tests cover contract trust, HMAC validation, immutable identities, state transitions,
AI output integrity, diff limits, baseline comparison, and the real local D1/webhook
path. Review deployment uses a separate Worker and D1 database. CI validates PRs;
credentialed deployment is gated by a GitHub environment and excludes fork PRs.
Main deploys only following human merge, never automatically merged by this agent.

Remaining production gates: GitHub App installation, approved contracts and teams,
Cloudflare production resources, judge identity/roles, sandbox fleet, execution
attestation, baseline build/test evidence, and operational load/adversarial drills.

The Daksh-Codebase test console runs behind the existing internal Workflow host.
The public branch Worker forwards only organization routes through a service binding;
the internal handler enforces its configured exact public origin and organizer session.
A separate organization D1 stores AES-GCM encrypted App credentials and private
immutable evaluations. A random vault key and bootstrap access code are Worker
secrets available only on the internal host. Test credentials belong to the dedicated
organization App; production integration requires its own host, resources and secrets.

GitHub manifest registration requires owner approval. Callback state is session-bound,
expiring and single-use. Returned organization and permissions are validated before
storing the key. Installation callbacks validate the App and organization via App JWT;
repository selection is fetched from GitHub. Read operations mint restricted short-lived
tokens; evaluation tokens additionally allow Checks publication on one selected repo.
Lifecycle deliveries have identity/hash replay protection. A suspension event checks
current installation state before revoking access, preserving newer unsuspensions.
