# Judge-C2C pre-launch hackathon rehearsal

## Executive summary

**Do not launch an unattended real hackathon yet.** A controlled real GitHub loop
works, and the system distinguishes valid attribution from successful functionality.
The rehearsal found seven material defects, reproduced five directly as failing
integration assertions, and added fixes and regression coverage. Launch blockers
remain in permissions, execution availability, moderation, reporting breadth and
review calibration. Green tests are not a substitute for those missing capabilities.

Identity boundary: twelve teams have **fixture** numeric GitHub identities in an
isolated Miniflare/D1 database. The private GitHub repository
[Daksh-Codebase/judge-c2c-qa-rehearsal](https://github.com/Daksh-Codebase/judge-c2c-qa-rehearsal)
contains three controlled PRs authored by **one actual account**, daksh1403. They
are alternative QA code fixtures, not three independent real participants. The
live team is explicitly named and annotated as QA, and eligibility is restricted
to the private QA repository. No challenge repository was rewritten or merged.

Read the machine-readable [master matrix](test-matrix.json),
[live evidence](live-evidence.json) and [Docker evidence](docker-evidence.json).
They distinguish real GitHub integration, simulated actors, real Docker execution
of controlled code, and capability audits. Unsupported or untested behavior is
not recorded as PASS.

Verification in this cycle: 110 unit/integration tests, seven browser tests, real
Docker containment/solution fixtures, three signed live PR events, real Check
publication, audited completion and live desktop/mobile dashboard inspection.

## Feature coverage

| Subsystem                     | Result                        | Evidence and limits                                                                                                                            |
| ----------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Team identity and import      | PASS                          | Stable IDs, verified numeric members, duplicate rejection, atomic imports; participant registration absent                                     |
| Repository/issue assignment   | PASS                          | Exclusive races, inactive/wrong-repository denial, immutable versions; rejection guards repaired                                               |
| PR mapping and history        | PASS                          | Twelve-team integrated state, unknown/wrong mappings, multi-issue/alternate PRs, head supersession, real signed PR events                      |
| Issue labeling and claims     | BLOCKED live                  | Rule/outbox fixtures pass; existing App lacks Issues write and issue/comment subscriptions                                                     |
| Objective Node HTTP checks    | PASS within supported profile | Real 4/4 reference, 3/4 partial, 1/4 hardcoded; baseline comparison and failure isolation                                                      |
| AI approach review            | PARTIAL                       | Eleven fields and evidence validation; real CallMissed PR review completed; provider/schema failures remain visible and calibration incomplete |
| Security/quality/architecture | PARTIAL                       | Routing and contextual reasoning; no full SAST/dependency/architecture analysis pipeline                                                       |
| Benchmarks/coverage           | NOT IMPLEMENTED               | No corresponding execution/report adapters                                                                                                     |
| Additional contributions      | PARTIAL                       | Categories and evidence-backed findings; no dedicated functional contribution verification model                                               |
| Dashboard                     | PARTIAL                       | Core team/issue/submission/evidence/mobile views work; requested overview metrics, filters and sorting incomplete                              |
| Authorization                 | PARTIAL                       | Organizer session, same-origin and isolated anonymous previews; distinct judge/participant roles absent                                        |
| Audit/reproducibility         | PARTIAL                       | Inputs/versions/heads/execution/AI traces retained; evaluator release is not fully part of cache identity                                      |
| Burst handling                | PARTIAL                       | Three real simultaneous PRs exposed capacity loss; durable busy retry restores verification; event-scale capacity unproven                     |

## Participant scenarios

A–F correctly map to their own teams/assignments, but a VALID submission does not
claim feature success. Their mapping fixtures do not establish quality, security,
regression or additional-contribution credit. Actual reference/partial/hardcoded
code executes in Docker and has different objective outcomes.

G is WRONG_REPOSITORY; H is NEEDS_TEAM_MAPPING and leaves its intended fixture
team visible as not submitted; I is NEEDS_ISSUE_MAPPING. J retains both legitimate
issue IDs. K preserves the old superseded run and the new exact head. L creates
separate PR submissions. A second member can submit for the same stable team.
Withdrawn/disqualified submitters produce no evaluation.

All seventeen requested approach-quality variants have **not** been calibrated
against a real model. Root-cause versus symptom masking, overengineering,
architecture bypass, races and unjustified dependencies remain contextual review
questions. Fixed finite acceptance cases cannot prove arbitrary correctness or
resistance to a participant memorizing all known inputs.

## GitHub workflow

The private QA repository has a frozen README-only baseline, explicit retry issue
and real ideal/partial/hardcoded implementation PRs. The App reads private contents;
three signed `pull_request` deliveries completed, and the new heads automatically
received separate evaluations. Native GitHub Checks point at exact evaluated SHAs
and show neutral, failure or action-required rather than fabricated full success.
Checks are currently published at completion; pending/running publication is missing.

The first burst produced one execution-backed report and two UNVERIFIED reports
because busy responses were treated as unavailable. After the retry fix, all three
new heads have trusted results. Old evaluations remain available. Duplicate delivery,
closure/reopening, late webhook and native link behavior also have fixture coverage.
Issue/comment webhook and App label writes remain blocked by installation permission.
Manual CLI writes must not be confused with App automation.

## Evaluation quality and evidence

The baseline has no server, so trusted cases fail before the submission. Ideal code
passes all four, partial code fails permanent-error stopping, and hardcoded code
passes only the temporary-success case. These are frozen, organizer-owned probes;
participant `node --test` output is supplemental. A zero-test command can report
PASS without proving behavior; the UI and evidence distinguish that from acceptance.

The AI cannot invent evidence IDs, waive criteria, convert source presence into
functional PASS or replace objective FAIL. Provider failure preserves deterministic
results and leaves approach conclusions unverified. Review prose is inference,
not scanner evidence. The current CallMissed Responses adapter uses strict schema output,
local evidence validation, no tools, a fixed endpoint, no redirects and `store:false`.
Configuration is backend-only. Model identity, response ID and usage enter the trace.

## Dashboard validation

Browser tests cover filters, criterion evidence navigation, hostile HTML escaping,
current/historical runs, no-submission teams, linked issue provenance, structured
approach sections and mobile widths. Live organizer access and real issue display
were verified separately. API count assertions in the 12-team rehearsal show 12 teams,
13 submissions, 3 mapping-attention states and 1 unattributed/not-submitted team.
These assertions prevent an aggregate count from silently diverging from stored rows.

Missing: complete requested global KPIs, arbitrary sorting/filter combinations,
coverage/benchmark/security report adapters, separate role-specific team portals,
and a unified independently verified additional-contribution panel. Organizer
visibility is not proof of participant cross-team isolation; participant roles do
not exist yet.

## Security and adversarial results

Controlled Docker probes confirmed nonroot UID, denied external/metadata networking,
read-only root, no injected production/GitHub/OpenAI/tunnel secrets, no other submission
mount and enforced process limits. A finite 80-child attempt was contained; no host
fork bomb was run. Infinite CPU and excessive stdout become UNVERIFIED, crashes FAIL,
and a subsequent build still PASS. Trusted acceptance evidence survives those failures.

Prompt-injection fixture text cannot change the frozen contract or validated verdict.
Other tests reject symlinks, submodules, huge/truncated source, forged requests, replay,
unsigned runner results and credential-bearing redirects. These do not prove absence
of kernel escape, every secret format or every prompt-injection strategy. Shared-kernel
Docker is development isolation. Dependency-install scripts are not supported and were
not executed. There is no production microVM rollout in this account.

## Fairness risks

Repaired: revoked submitter eligibility at completion, assignment of rejected
challenges, stale completed progress on new heads and paused-event new intake.
Historical accepted decisions remain immutable. Human overrides remain auditable.
GitHub issue closure does not establish judged completion.

Residual: insufficient/generalized acceptance criteria, incomplete scanner coverage,
uncalibrated AI interpretation, no participant issue quotas, missing deadline policy,
limited role separation and launch-time policy/setup gaps. Public security reports
cannot be made private retroactively; private GitHub reporting must be configured.

## Performance and caching

The integration rehearsal submits work from twelve fixture teams into durable D1
state; this is correctness/concurrency coverage, not a production throughput claim.
The actual burst is three PRs, suitable for this Mac. It reproduced runner backpressure
and verified recovery using bounded durable retries. Retries recheck current head so
obsolete work stops at the workflow boundary; active Docker cancellation can lag.

Unchanged input reconciliation and frozen-diff reuse are tested. Dependency caches,
warm production capacity, tool-version-wide invalidation, comprehensive resource/cost
metrics and a deadline-size load profile remain unimplemented or unverified. No p95
latency or 100-team capacity is asserted.

## Defects and remediation

| ID  | Severity | Reproduction / actual behavior before fix                                                            | Expected / remediation                                                                |
| --- | -------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| D01 | High     | Remove author membership after completed run; acceptance succeeds                                    | Completion transaction requires current membership or frozen audited override         |
| D02 | High     | Reject previously official challenge; new assignment still succeeds and labels indicate availability | Require current official approval in assignment transaction and honor rejected status |
| D03 | Medium   | Accept head A, enqueue head B; assignment remains COMPLETED                                          | Recompute current progress immediately; retain acceptance only in immutable history   |
| D04 | Medium   | Set event PAUSED; PR still creates evaluation and claims continue                                    | Reject new assignments/completion and explicitly record inactive-event submissions    |
| D05 | Medium   | Crash final PROCESSING inbox attempt with expired lease; it stays stuck                              | Mark exhausted work FAILED with explicit recovery reason                              |
| D06 | High     | Kill runner process while guest runs; process-local cleanup registry disappears                      | Independent 120-second guest lifetime plus startup discovery/reaper before listening  |
| D07 | High     | Three live concurrent PRs; two lose all execution evidence on busy runner                            | Distinguish RUNNER_BUSY and use bounded durable retry/backoff                         |

D01–D05 have pre-fix failing integration assertions. D06 is a source-proven crash
lifecycle fault with discovery/cleanup regression tests; destructive host SIGKILL was
not necessary. D07 has before/after real GitHub/evaluation snapshots. CPU/output
failure isolation is real Docker, not mocked containment. All fixes stay on the QA
feature PR; none are merged.

## Launch blockers

- Approve App Issues write and issue/comment subscriptions, then validate real
  issue labeling/claiming/reconciliation with owner-approved credentials.
- Prepare meaningful challenge codebases, frozen contracts, regression requirements
  and teams. The five original repositories remain README-only.
- Replace Mac/quick-tunnel dependence with a supported isolated execution service
  or explicitly restrict launch to supervised development trials.
- Complete scanner/benchmark/coverage support required by actual challenge categories.
- Validate reviewer reliability and the untested approach-quality/adversarial corpus.
- Add participant identity/roles, moderation quotas and event-scale burst readiness
  before opening unrestricted registration or issue discovery.

## Recommended next actions

**Critical:** permissions/events, authoritative real challenge setup, execution
availability/isolation, verify the CallMissed key and real structured review.

**High:** pending/running Checks, issue abuse controls, required scanner adapters,
regression suites and a larger bounded burst with measured stage/queue latency.

**Medium:** complete dashboard KPIs/filter/sort, contribution verification,
independent reviewer calibration and artifact storage/retrieval tests.

**Low:** advisory semantic duplicate detection, richer registration UX and warm
capacity after a measured operational need.

## Historical OpenAI activation result

Before the provider switch, the backend secret existed and the OpenAI adapter was deployed using the pinned
`gpt-5.4-mini-2026-03-17` model. The actual Responses request returned HTTP429 on
two bounded attempts. This is a provider rate/quota limitation, not a successful
OpenAI evaluation. See [the real diagnostic trace](openai-live-evidence.json). No
key plaintext or arbitrary provider error body is stored. Model/schema compatibility
remains UNVERIFIED until a permitted request completes. Review failure preserves
objective criteria and produces no invented approach.

## Reproduction

- `npm run check` runs the application suite including the multi-team rehearsal.
- `npm run test:browser`; optionally set `REVIEW_URL` to the bot preview.
- `node scripts/hackathon-docker-rehearsal.mjs` explicitly runs controlled code in
  the existing development Docker image and writes ignored raw evidence.
- Live evidence is a timestamped observation, not a script that creates GitHub
  objects on every CI run. Keep live fixture PRs open for inspection; never auto-merge.

## Provider change after rehearsal

At the user's request, the selected reviewer is now CallMissed, using its Responses
API and `CALLMISSED_API_KEY`. The OpenAI HTTP429 evidence above remains a historical
result, not a CallMissed test. Its separate backend key is now configured. The first real request returned
403 MODEL_NOT_AVAILABLE for a paid model; the selected model is now `kimi-k2.6`,
which the public catalog marks free-plan eligible. Provider/schema validation is
being tested separately and is not implied by local green tests. The model catalog
does not advertise zero-data retention; `store:false` is not an upstream retention guarantee. No OpenAI endpoint is used by the current implementation.

## Pull request and preview

[QA and provider PR #3](https://github.com/daksh1403/judge-c2c/pull/3) is stacked on
#2 and remains unmerged. The native Cloudflare bot preview is
https://test-hackathon-rehearsal-judge-c2c.dakshx.workers.dev. Seven browser tests
passed against that deployment. The first CI run exposed the integrated twelve-team
scenario exceeding Vitest's default five-second budget on the slower CI host; its
explicit integration timeout is now thirty seconds with unchanged assertions.

## CallMissed real PR review

The actual QA repository PR #2 at head `53c8d6f3980eec4cf78757917f123c286468ab55`
received a validated CallMissed/Kimi K2.6 review on the first attempt in 44.9 seconds,
with all eleven approach fields and known evidence citations. The response ID and
4,803-token usage are retained in [the live PR evidence](callmissed-pr-evidence.json).
Functional criteria remained UNVERIFIED because the development tunnel was unavailable,
which demonstrates that successful AI does not fabricate successful execution.
The local service and tunnel were restarted and a fresh exact head is being evaluated.
The separate synthetic diagnostic did not validate; its provider history is retained
in [diagnostic evidence](callmissed-live-evidence.json). A real success is not a claim
that every adversarial scenario or model response is reliable.
