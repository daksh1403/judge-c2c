# Participant GitHub readiness audit

Inspected with the organizer's authenticated `gh` CLI on 2026-10-02. These are
observations of the test organization, not acceptance results or judging rules.
The production integration continues to use short-lived GitHub App credentials.

## Confirmed integration

Judge-C2C App `judge-c2c-daksh-codebase`, App ID 5154942, installation 167005353,
is active on all five Daksh-Codebase repositories. Its current installation has
Contents/PRs/Issues read and Checks write, and subscribes only to `pull_request`.
The owner must enable Issues read and write, subscribe to `issues` and
`issue_comment`, and approve the installation's requested permission update before
automatic label writes and participant `/judge claim` events can work.

Another installed App, `daksh-codebase-workboard`, already manages some labels and
starter issues. Judge-C2C uses its own `judge:` taxonomy, preserves unrelated labels,
and does not interpret that App's labels as authoritative challenge approval.
Through `gh`, 35 controlled `judge:` label definitions were created in each of the five
repositories (175 total), preserving all 56 unrelated labels. This provisioned taxonomy
definitions only: no participant issue was scored, approved, assigned, or closed.
App-based label application is still blocked until the installation gains Issues write.

## Repository and baseline observations

| Repository        | Main commit observed                       | Contents       |
| ----------------- | ------------------------------------------ | -------------- |
| payment-engine    | `167b52faed920c19b649a65c3f3cc2eb131a7eff` | README.md only |
| inventory-control | `6c01a33f8d55a3b09b939b88e1b655b120b6e333` | README.md only |
| care-coordinator  | `64b535c11a66ccb269851e3fd7afb9bb3929f291` | README.md only |
| campus-connect    | `d80aeb6307761378889d88a0e4e7a46756cb5289` | README.md only |
| service-desk      | `79ed9a6172b8090c4c61c0bd431f1591b432d686` | README.md only |

All five are public, have issues enabled, and are not archived. These observed
commits become evaluation baselines only through an organizer-published contract;
this document does not assign or activate them.

## Existing participant-style submission

[payment-engine PR #4](https://github.com/Daksh-Codebase/payment-engine/pull/4)
is open, non-draft, authored by `daksh1403`, and adds one line to README.md.
Its head is `3331153c7af28c7a8d927dc2894584b9f9bdb8e2`. It has no PR description,
linked closing issues, Actions workflows, or check results. The title of Issue #1
mentions payment retries, but its body says it is a label-assignment test. It does
not define acceptance criteria for payment behavior. No payment implementation
or tests exist in the repository baseline.

The collaborator lists for all five repositories contain only the organizer account.
The only organization member returned is `daksh1403` (numeric GitHub ID 166613207).
Organization membership alone does not create a Judge-C2C team. The live management
backend currently has no registered teams, official challenges, assignments, or
participant evaluations. A genuine team must be created/imported and activated,
assigned a repository and an official versioned issue; the PR then needs a legitimate
issue link or an audited organizer resolution.

Payment-engine main is currently unprotected. Its GitHub private vulnerability
reporting is disabled. A vulnerability must not be filed with public exploit details;
organizers should enable GitHub private reporting and direct participants to Security.
Judge-C2C does not change those repository policies during an inspection.

## What is actually verified

The deployed protected console can read the installation's real capabilities and
synchronize the real payment-engine issue. The AI provider diagnostic returned valid
structured output; this diagnostic is explicitly synthetic. The local Docker runner
has passed isolated resource/network and signed tunnel canaries. Neither diagnostic
establishes functional behavior of the README-only PR.

The team/assignment/submission loop is covered by deterministic integration fixtures,
including head updates, mapping ambiguity, version pinning, competing PRs, concurrent
claims, organizer overrides, stale completion rejection, and unchanged reconciliation.
A live participant run still requires a real challenge contract and assigned team.
