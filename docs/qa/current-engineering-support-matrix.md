# Engineering review support matrix

Current runtime projection: `src/engineering-review.ts`; report serialization: `src/workflow.ts`; judge display: `public/organization.js`.

The report now includes 49 explicit facets: solution facets 25.01–25.16 and 25.18, all eleven quality facets, all eleven security facets and all ten architecture facets. The six parent dimensions independently distinguish configured check facts, deterministic inspection recommendations and model narrative. The existing provider response schema and local grounding rules are preserved.

- `SUPPORTED_FACT` covers only compatible configured check outcomes and known baseline/head check deltas. It never promotes a lint pass into naming, separation, maintainability or architecture proof.
- `SUPPORTED_ENGINEERING_ASSESSMENT` identifies server-derived recommendations to inspect a measured regression/failure or obtain missing configured execution. It is not a dimension-wide verified judgment.
- `UNVERIFIED` remains explicit for semantic facets without a relevant analyzer or authoritative scoped evidence, and for arbitrary model narrative. Each rubric row provides a specific inspection reason. Private participant intentions remain unknown and are never inferred.

The supported fact rows 25.15/25.16 are scoped to check deltas/outcomes. The remaining semantic rows provide an explicit review rubric and missing-evidence guidance; their presence is not proof of universal semantic analysis. Dependency advisory matches remain metadata context, not exploitability conclusions. Missing coverage or benchmark results do not imply success.

Executed local verification:

- `npx vitest run tests/engineering-review.test.ts tests/claim-grounding.test.ts tests/requirement-assessment.test.ts` — 18 tests passed. Fixtures cover positive configured facts, baseline regressions/improvements, missing benchmark/coverage checks, source-only context, unknown evidence, subset relevance, arbitrary optimistic model prose and retained mandatory failures.
- `npm run typecheck` — passed.
- `npm run test:browser -- --grep 'engineering support matrix'` — 1 test passed. Mocked API data demonstrates the rendered fact/assessment/unknown distinction, human inspection reason and architecture UNVERIFIED state.

The original `docs/qa/payment-calibration-evidence.json` remains unchanged as historical calibration evidence. This matrix does not erase known narrative accuracy limitations, classify an incomplete AI response as complete or grant additional-work credit. Deployed replay at the current server policy is a separate lead-owned verification.

Persisted backend evidence at policy `requirements-and-approach-v10`: PR8 run `e8da8d90134694dd7532c9268a4197c1be628e761beb13c1e3dc6bf9b92faa6e` and PR9 run `b7e11a2c8ab4cb7b2c83db62b6ae7449ef918da8c4f23be121b89ccaec5048ff` both passed the replay inspector against their existing completed evaluations, without triggering new AI attempts. Their current-payment-grounding JSON records contain all 49 rubric rows and six parent matrices, zero unknown fact citations, unverified arbitrary narrative, no unrelated lint promotion, explicit unknown private intentions and retained human attention. Mandatory criterion outcomes remain consistent with objective evidence; PR9 retains its protected-path failure. Artifact download integrity passed and unauthenticated download returned 401.

The observed PR11 attempt `b38cd9a1fc72933cf7b97ecf7704d506c13ad2df2f55ba582a8c5bc0df6a8237` rejected AI review with `AI_APPROACH_UNSUPPORTED`; this failure must remain historical evidence rather than be described as a complete supported AI analysis. A later retry, if authorized by the lead, is a separate attempt. At the time of these checks the deployed static organization UI did not yet contain the new matrix renderer; the successful new-matrix browser check is therefore local and mocked until the lead publishes current assets.
