# Judge UI stabilization evidence

Actual deployed browser evidence: `docs/qa/current-native-preview-judge.json` and `.png`, captured 2026-10-04 at 08:19:52 UTC against `https://feat-evaluation-completeness-judge-c2c.dakshx.workers.dev`. `scripts/current-judge-ui-evidence.mjs` uses an isolated Playwright browser with authenticated judge access read from a local untracked credential file. It injects no mocks, performs no recognition decisions and emits no credentials.

| Item  | Observed deployed evidence                                                                                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16.08 | A historical evaluation displays the existing obsolete/historical warning.                                                                                                         |
| 39.29 | An existing contribution is rendered with evidence/provenance; judge recognition is unavailable. Human attribution and recognition remain separate.                                |
| 40.13 | The 35 returned persisted evaluations are ordered by latest creation timestamp.                                                                                                    |
| 41.13 | Selecting PARTICIPANT issues requests the source filter and returned rows all have PARTICIPANT source.                                                                             |
| 41.14 | A deployed issue detail renders related PR submissions.                                                                                                                            |
| 41.15 | Related submissions display evaluation state or explicit unavailable-for-current-head state.                                                                                       |
| 45.16 | The selected completed evaluation has 52 persisted artifact records and renders artifact context.                                                                                  |
| 45.17 | The selected persisted report contains an AI reviewer trace.                                                                                                                       |
| 47.11 | The persisted historical trace records reviewer policy `requirements-and-approach-v9` and model-routing version `server-model-routing-v1`. New policy replay is separate evidence. |

Four existing local browser fixtures also passed: judge historical detail/artifact gating, organizer contribution decisions, read-only judge navigation/filters, and team/issue provenance. Those fixtures use mocked API data and establish rendering/guard behavior only.

This verifies the observed isolated review deployment and persisted development evaluations. It is not an operational hackathon, proof of every stale-view race, event-scale load test or production secret/binding audit. Native Chrome inspection was interrupted by the user's concurrent tab activity; the successful deployed checks used an isolated headless browser instead. No application feature changes were required for these probes.
