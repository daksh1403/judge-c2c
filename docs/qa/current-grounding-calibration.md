# Original grounding calibration — resolved

The original payment-engine issue6 contract and immutable baseline `65cb717281eaa2aced69dfaa68ac06c6d540ce2a` were replayed with the actual GitHub integration, Docker execution boundary and Cloudflare model. These are the original referencePR11, partialPR8 and protected-testPR9 scenarios, not replacements.

| Submission      | Run                                                                | Deterministic result                             | AI                  |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------ | ------------------- |
| Reference11     | `190c202511e8184284585b8e8a230c2d03108e1ac9a46f77dc4b66d9cd29f4b0` | all18 criteriaPASS                               | executed, COMPLETED |
| Partial8        | `c1584d2443a439da1c3424138ac26675ee05424facf450e8cb72b1645ec5e342` | bounded-retryPARTIAL, failed criterion preserved | executed, COMPLETED |
| Protected-test9 | `886dfcbfc1463637494b65fe8a6ec3e5ae05aa157c29b54f30c37157f53e7a63` | protected-test manipulationFAIL preserved        | executed, COMPLETED |

All reports have consistent objective criterion statuses, zero unknown citations and zero unsupported OBSERVED claims. Only exact cited objective facts enter the observed layer; qualitative prose and findings remain explicitly unverified interpretations. Each report requires human attention. GitHub publication completed. Protected artifacts returned200 with checksum match; anonymous download returned401.

The previous false-coverage defect is fixed at the factual boundary: no measurement supports a coverage claim, so model prose cannot assert it as observed or override objective outcomes. Known citation IDs alone are insufficient. Focused tests reject contradictions and unknown citations, exercise unsupported coverage/test/performance claims, and verify incomplete criterion responses recover only deterministic statuses while leaving missing qualitative analysisUNVERIFIED and stageNEEDS_REVIEW. Current successful responses included all criteria; they did not require incomplete-response recovery.

Evidence: current-payment-grounding-8.json, current-payment-grounding-9.json and current-payment-grounding-11.json; tests/claim-grounding.test.ts and tests/callmissed-review.test.ts. Failed CallMissed budget and Cloudflare validation attempts remain historical database records; this result does not certify the truth of qualitative interpretations, multiple independent identities, comprehensive coverage, or production capacity.
