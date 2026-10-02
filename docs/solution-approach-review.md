# Solution approach review

For every meaningful engineering submission, reconstruct and evaluate the
observable solution approach from the PR, diff, commits, relevant repository
context, tests, PR description, and deterministic evidence.

Determine:

- What problem was the participant trying to solve, as described by observable artifacts?
- What engineering approach did they choose?
- What components did they modify?
- Why does the implementation appear to use this approach?
- Does the approach address the root problem or only symptoms?
- Is the solution unnecessarily complex?
- Is there a simpler or more robust approach?
- Does it fit the repository's existing architecture?
- What tradeoffs were introduced?
- What assumptions does the solution make?
- Are important edge cases ignored?
- Is the implementation scalable and maintainable?
- Did the approach introduce regressions or security risks?
- Does objective evidence demonstrate that the approach works?

Produce separate structured fields for `problem_understanding`, `approach_summary`,
`solution_design`, `strengths`, `weaknesses`, `tradeoffs`, `correctness`,
`maintainability`, `architecture_fit`, `evidence`, and `unverified_assumptions`.

Do not claim to know the participant's private reasoning or intentions. Describe
only the engineering approach observable from submitted artifacts and evidence.

## Evidence and output contract

Reports use `solution_approach`. The scalar fields are observations containing
`text`, known `evidenceIds`, and `verification` (`OBSERVED`, `INFERENCE`, or
`UNVERIFIED`). Strengths, weaknesses, tradeoffs, and assumptions contain bounded
lists of those observations. `evidence` lists all referenced ledger IDs.
Assumptions always remain `UNVERIFIED`. Observed correctness requires criterion-
associated execution evidence; participant test exit codes alone cannot establish
acceptance. Requirement assessment validation remains independent and stricter.

The reviewer receives redacted PR description, bounded commit messages, exact
baseline-to-head changes, bounded baseline/head sources, authoritative criteria,
and objective results. Commit messages and source excerpts may be truncated;
missing architecture or runtime context must be acknowledged. No model tools can
execute commands, alter files, access secrets, or redefine requirements.

Provider failure, unavailable execution, oversized context, or invalid output
produces an explicit unverified fallback. Existing historical reports are shown
without inventing a retrospective approach review.
