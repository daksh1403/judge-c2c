# Scoped semantic review projection

The existing workflow serializes engineering-review v2 through the same helper; provider schema and objective grounding remain unchanged. Facets now reference specific persisted approach observation paths or finding indexes, with exact server-owned source paths, criterion-to-requirement links and configured typed-check IDs. Field/topic routing denotes relevance for inspection only. Every contextual narrative remains UNVERIFIED; lint or source presence cannot establish semantic correctness. Missing/uncited/unknown-citation analysis and private intentions remain missing-analysis/unknown.

Authenticated reads of the actual isolated preview original reports (no AI calls, retries or report mutation) were projected locally using current source. This is actual persisted-report input evidence, not a claim that deployed backend or static UI already serves the new projection.

PR8: 12 contextual facets: 25.01, 25.02, 25.04, 25.08, 25.09, 25.10, 25.11, 25.12, 25.15, 25.16, 27.01, 27.09. Remaining 37 facets are guidance only; exact IDs and observation/citation links are recorded in current-semantic-facet-projection.json.

PR9: 15 contextual facets: 25.01, 25.02, 25.04, 25.06, 25.08, 25.09, 25.10, 25.11, 25.12, 25.14, 25.15, 27.01, 27.07, 27.09, 28.02. Remaining 34 facets are guidance only; exact IDs and observation/citation links are recorded in current-semantic-facet-projection.json.

PR11: 23 contextual facets: 25.01, 25.02, 25.03, 25.04, 25.06, 25.08, 25.09, 25.11, 25.12, 25.13, 25.15, 25.16, 27.01, 27.06, 27.07, 27.09, 28.02, 28.07, 28.11, 29.03, 29.05, 29.06, 29.09. Remaining 26 facets are guidance only; exact IDs and observation/citation links are recorded in current-semantic-facet-projection.json.

Across all three reports, contextual analysis exists for: 25.01, 25.02, 25.03, 25.04, 25.06, 25.08, 25.09, 25.10, 25.11, 25.12, 25.13, 25.14, 25.15, 25.16, 27.01, 27.06, 27.07, 27.09, 28.02, 28.07, 28.11, 29.03, 29.05, 29.06, 29.09.

Guidance only in all three reports: 25.05, 25.07, 25.18, 27.02, 27.03, 27.04, 27.05, 27.08, 27.10, 27.11, 28.01, 28.03, 28.04, 28.05, 28.06, 28.08, 28.09, 28.10, 29.01, 29.02, 29.04, 29.07, 29.08, 29.10. These gaps remain explicit and require human inspection or meaningful future analysis; no universal analyzer or semantic PASS is claimed.

Validation: 19 focused engineering-review/claim-grounding tests, TypeScript checks and one local mocked browser fixture passed. Positive fixtures verify observation paths/finding indexes/typed evidence; negative fixtures reject unknown citations and prevent lint-based semantic promotion. The browser fixture verifies contextual-analysis visibility and missing authentication-analysis attention.
