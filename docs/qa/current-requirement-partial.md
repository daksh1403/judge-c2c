# Requirement-level PARTIAL evidence

Acceptance item: 26.09. Scope: deterministic aggregation and synthetic judge UI fixtures.

The implementation already exists in `src/requirement-assessment.ts`; no aggregation or provider-schema rewrite was necessary. The API returns its `requirementResults` projection, and the judge detail renders the requirement badge independently of each criterion result. `groundReview` derives criterion assessments from objective evidence, and GitHub check publication reads authoritative failures separately from the requirement badge.

| Objective criterion states                      | Requirement state | Criterion preservation                        | Completed GitHub conclusion              |
| ----------------------------------------------- | ----------------- | --------------------------------------------- | ---------------------------------------- |
| PASS + FAIL                                     | PARTIAL           | The failed mandatory criterion remains FAIL   | failure                                  |
| PASS + UNVERIFIED                               | PARTIAL           | Missing verification remains UNVERIFIED       | action_required                          |
| PASS + PASS                                     | PASS              | Both objective passes remain visible          | neutral; human judgment remains required |
| No execution or functional source-only evidence | UNVERIFIED        | Functional source presence cannot become PASS | action_required                          |

New deterministic integration fixtures in `tests/requirement-assessment.test.ts` exercise aggregation, grounding and GitHub publication together. They deliberately supply optimistic AI assessments and summary prose; grounding restores objective criterion states and the summary, and publication retains overall failure/attention precedence. Existing fixtures also cover contradictory objective evidence, optional requirements and unrelated extra-work evidence.

Executed validation:

- `npx vitest run tests/requirement-assessment.test.ts tests/claim-grounding.test.ts tests/github-checks.test.ts` — 3 files, 22 tests passed.
- `npm run typecheck` — passed.
- `npm run test:browser -- --grep 'judge detail separates stale runs'` — 1 browser test passed. It confirms the visible PARTIAL requirement badge, attention label and retained FAIL criterion in the existing judge detail.

These are local synthetic fixtures and current source checks. The browser test uses mocked API data; it does not prove live participant execution, production provider calibration or an operational hackathon evaluation. Contextual AI cannot manufacture objective PASS, and requirement-level PARTIAL never offsets a failed mandatory criterion.
