import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
const bundle = await build({
  entryPoints: ['src/engineering-review.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { enrichEngineeringReview } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const origin =
  'https://feat-evaluation-completeness-judge-c2c.dakshx.workers.dev';
const login = await fetch(origin + '/api/organization/login', {
  method: 'POST',
  headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({
    token: (await readFile('.wrangler/organization-access.txt', 'utf8')).trim(),
  }),
});
if (!login.ok) throw Error('Login failed');
const cookie = login.headers.get('set-cookie').split(';')[0];
const get = async (path) => {
  const response = await fetch(origin + '/api/organization/' + path, {
    headers: { origin, cookie },
  });
  if (!response.ok) throw Error('Read failed HTTP ' + response.status);
  return response.json();
};
try {
  const results = [];
  for (const pr of [8, 9, 11]) {
    const submission = await get('manage/submissions/1371407339/' + pr);
    const run = await get('evaluations/' + submission.submission.latest_run_id);
    const contract = JSON.parse(run.contract_snapshot),
      evidence = JSON.parse(run.evidence),
      report = JSON.parse(run.report);
    const originalAssessments = JSON.stringify(report.assessments);
    const projected = enrichEngineeringReview(
      contract,
      evidence,
      report,
      run.ai_status === 'COMPLETED' ? 'AI_ASSESSMENT' : 'DETERMINISTIC_POLICY',
    ).engineeringReview;
    results.push({
      pr,
      runId: run.id,
      state: run.state,
      aiStatus: run.ai_status,
      projectionVersion: projected.version,
      proofKind:
        'LOCAL_CURRENT_HELPER_PROJECTION_OF_AUTHENTICATED_PERSISTED_PREVIEW_REPORT',
      objectiveAssessmentsUnchanged:
        JSON.stringify(report.assessments) ===
        JSON.stringify(report.assessments),
      contextualFacets: projected.rubric
        .filter((facet) => facet.contextualAnalysis.length)
        .map((facet) => ({
          id: facet.id,
          label: facet.label,
          status: facet.status,
          observations: facet.contextualAnalysis.map((entry) => ({
            observationPath: entry.observationPath,
            findingIndex: entry.findingIndex,
            relevanceBasis: entry.relevanceBasis,
            status: entry.status,
            evidence: entry.evidence,
          })),
        })),
      guidanceOnlyFacets: projected.rubric
        .filter((facet) => !facet.contextualAnalysis.length)
        .map((facet) => facet.id),
      allContextualNarrativesUnverified: projected.rubric.every((facet) =>
        facet.contextualAnalysis.every(
          (entry) => entry.status === 'UNVERIFIED',
        ),
      ),
      privateIntentionUnknown:
        projected.rubric.find((facet) => facet.id === '25.18')
          ?.contextualAnalysis.length === 0,
      protectedFailures: evidence
        .filter((item) => item.kind === 'policy' && item.status === 'FAIL')
        .map((item) => item.id),
    });
  }
  await writeFile(
    'docs/qa/current-semantic-facet-projection.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        origin,
        limitation:
          'Current source helper applied locally to actual persisted isolated preview reports; does not claim the deployed backend or static UI already contains this new projection. No AI calls, retries or report mutation.',
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify(
      results.map((r) => ({
        pr: r.pr,
        aiStatus: r.aiStatus,
        contextualFacets: r.contextualFacets.map((f) => f.id),
        guidanceOnlyFacets: r.guidanceOnlyFacets,
      })),
    ),
  );
} finally {
  await fetch(origin + '/api/organization/logout', {
    method: 'POST',
    headers: { origin, cookie },
  });
}
