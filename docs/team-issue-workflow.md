# Teams, issues, assignments and submissions

This subsystem implements the owner's teams/issues/submissions specification and
solution-approach review addition. The essential two paths are:

1. Hackathon → stable team → verified GitHub members → eligible repositories →
   versioned official issue → assignment → linked PR → submission → immutable runs →
   evidence → organizer completion decision.
2. Participant → discovered GitHub issue → team attribution → conservative triage →
   controlled labels → organizer moderation/recognition/conversion.

GitHub is authoritative for native objects. Judge-C2C is authoritative for team,
competitive assignment, judging policy/version, evaluation and completion state.
GitHub closure and labels never establish successful challenge completion or credit.

## Implementation boundaries

- Event policy: configurable team/repository limits, issue ownership/capacity,
  claiming, multi-issue/multi-PR submissions and discovery credit. Organizer-created
  teams and validated CSV/JSON import are the initial registration paths. No anonymous
  self-registration; it remains policy-disabled until verified participant login exists.
- Identities: team IDs independent of names; GitHub numeric user IDs resolved through
  GitHub, with usernames retained for display. No fuzzy identity matching. Conflicting
  active memberships fail validation. Team status is independent of all other states.
- Issues: bounded authoritative GitHub snapshots, source/reporting-team provenance,
  advisory classifications, independent official approval, immutable contract versions,
  review flags, possible duplicate links and human overrides. An official conversion
  preserves original participant provenance.
- Assignments: relational repository eligibility plus issue ownership; exclusive claims
  use an atomic unique constraint, shared claims have bounded policy capacity.
  Revocation, expiration and reassignment preserve historical rows and audit.
- PR mapping: numeric author → active team → allowed repository → active assigned
  linked issue(s), backed by structured state. Unknown members, wrong repositories,
  missing links and conflicting links are explicit attention states. Organizer overrides
  require a reason and preserve the original conflict. Assignment versions freeze
  expectations; edited issue prose cannot redefine judging requirements.
- Intake: authenticated selected-installation events enter a persistent idempotent
  inbox; reconciliation retries and leases survive network/process failure. Label and
  assignment synchronization use an outbox. Automation recognizes its own label events;
  human labels/overrides are not repeatedly replaced.
- Reporting: the overview includes teams with no PR, linked team/issue/submission
  detail and current-versus-historical evaluations. Completion remains an audited
  organizer decision; acceptance eligibility derives from mandatory evidence.
- Security: participant issue text is hostile. Security reports are routed to protected
  organizer review and GitHub private vulnerability reporting; no exploit details are
  republished. Labeling needs explicit GitHub App Issues-write permission; permission
  absence is visible and retries do not pretend synchronization succeeded.
- Approach: structured problem_understanding, approach_summary, solution_design,
  strengths, weaknesses, tradeoffs, correctness, maintainability, architecture_fit,
  evidence and unverified_assumptions. Statements describe observable artifacts only,
  cite known evidence, and separate inference from functional verification.

## Requirement coverage ledger

The numbered entries below correspond to the owner's full product request. Each
requires implementation/verification before the PR can claim the core workflow ready.

| Sections          | Required behavior                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1–2               | First-class stable teams; members and verified numeric GitHub attribution                                                        |
| 3                 | Organizer creation; validated bulk import; registration policy                                                                   |
| 4–5               | Separate team lifecycle; auditable names, membership, identity and status changes                                                |
| 6                 | Multiple/shared repository eligibility and event-specific limits                                                                 |
| 7–8               | First-class issues; official versus participant provenance and moderation                                                        |
| 9–13              | Extensible controlled taxonomy, missing-label triage, uncertainty, human overrides and idempotent label reconciliation           |
| 14–15             | Useful issue templates and missing-information flags without fabricated details                                                  |
| 16                | Possible duplicates linked for human confirmation, never AI-only closure                                                         |
| 17–19             | Restricted security routing; severity separate from event priority; advisory difficulty                                          |
| 20–24             | Direct/shared/exclusive/restricted/reserved/blocked assignment, claiming race safety, lifecycle and immutable challenge versions |
| 25–29             | Structured team/repository/issue mapping; ambiguity and wrong-repository handling; native/structured PR link conflicts           |
| 30–34             | Multi-issue and multi-PR policy, separate submissions/runs, preserved heads/history and clear current evaluation                 |
| 35–38             | Search/sort/filter; no-submission teams; coherent team detail; reporter attribution                                              |
| 39–41             | Reviewed configurable discovery credit; closure distinct from success; quiet optional synchronization                            |
| 42–44             | Issue/team/submission dashboards, moderation, official challenges, triage and operational filtering                              |
| 45–48             | Idempotent GitHub reconciliation, attributable audit, human overrides and spam controls                                          |
| 49–53             | Issue requirements → assignment → automatic evaluation context; complete and unknown-submission paths                            |
| 54–57             | Engineering autonomy, simple extensible core, separate PR and Cloudflare review; no automatic merge                              |
| Approach addition | Evidence-backed observable approach fields; no private-intent claims                                                             |

Optional anonymous registration, elaborate skill matching, scoring engines and semantic
search are excluded from the initial core. Discovery recognition is recorded by humans,
not automatically scored. These boundaries must be reflected honestly in the PR.
