import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const origin =
  process.env.REVIEW_URL ||
  'https://feat-evaluation-completeness-judge-c2c.dakshx.workers.dev';
const login = await fetch(origin + '/api/organization/login', {
  method: 'POST',
  headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({
    token: (await readFile('.wrangler/organization-access.txt', 'utf8')).trim(),
  }),
});
if (!login.ok) throw Error('Login HTTP' + login.status);
const cookie = login.headers.get('set-cookie').split(';')[0];
async function call(path, body) {
  const r = await fetch(origin + '/api/organization/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, value: await r.json() };
}
try {
  const pr = Number(process.env.REPLAY_PR || 11);
  let submission = await call('manage/submissions/1371407339/' + pr);
  let id = submission.value.submission.latest_run_id;
  if (!id) throw Error('No evaluation');
  if (process.env.RETRY_CURRENT === '1') {
    const retried = await call('evaluations/' + id + '/retry', {});
    if (retried.status !== 202) throw Error('Retry HTTP' + retried.status);
    id = retried.value.runId;
    console.log(JSON.stringify({ retryStatus: 202, newRun: id }));
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      const state = (await call('evaluations/' + id)).value.state;
      if (['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(state)) break;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }

  const detail = await call('evaluations/' + id),
    run = detail.value,
    evidence = JSON.parse(run.evidence),
    report = JSON.parse(run.report),
    trace = report.aiTrace;
  const frozen = JSON.parse(run.contract_snapshot),
    context = JSON.parse(run.context);
  console.log(
    JSON.stringify({
      sizes: {
        contract: run.contract_snapshot.length,
        execution: JSON.stringify(frozen.execution).length,
        evidence: run.evidence.length,
        sources: JSON.stringify(context.sources).length,
        patches: JSON.stringify(context.files).length,
      },
      criteria: frozen.requirements.flatMap((r) => r.criteria).length,
    }),
  );
  const actual = Object.fromEntries(
    (run.requirementResults ?? []).flatMap((r) =>
      r.criteria.map((c) => [c.criterionId, c.status]),
    ),
  );
  const observations = Object.entries(report.solution_approach).flatMap(
    ([field, v]) =>
      field === 'evidence'
        ? []
        : Array.isArray(v)
          ? v.map((x, i) => ({ field: field + '[' + i + ']', ...x }))
          : [{ field, ...v }],
  );
  const unsupportedObserved = observations.filter(
    (o) =>
      o.verification === 'OBSERVED' &&
      !o.evidenceIds.some((id) =>
        evidence.some(
          (e) =>
            e.id === id &&
            e.status !== 'UNVERIFIED' &&
            e.claim.trim() === o.text.trim(),
        ),
      ),
  );
  const result = {
    at: new Date().toISOString(),
    mode:
      'REAL_GITHUB_DOCKER_' +
      String(trace?.provider ?? 'UNKNOWN').toUpperCase(),
    identity:
      'One actual authenticated operator; replay code persona, not multiple independent accounts',
    pr,
    runId: id,
    state: run.state,
    aiStatus: run.ai_status,
    publication: run.publication_status,
    baseline: run.baseline_sha,
    head: run.head_sha,
    requirements: run.requirementResults,
    trace,
    unsupportedObserved: unsupportedObserved.length,
    criterionConsistency: report.assessments.every(
      (a) => actual[a.criterionId] === a.status,
    ),
    summary: report.summary,
    observations,
    assessments: report.assessments,
    knownEvidenceIds: evidence.map((e) => e.id),
    unknownCitations: [
      ...report.assessments.flatMap((a) => a.evidenceIds),
      ...observations.flatMap((o) => o.evidenceIds ?? []),
      ...report.findings.flatMap((f) => f.evidenceIds),
    ].filter((id) => !evidence.some((e) => e.id === id)),
    protectedEvidence: evidence.filter(
      (e) => e.kind === 'policy' && e.status === 'FAIL',
    ),
    executionFailures: evidence.filter(
      (e) => e.kind === 'execution' && e.status !== 'PASS',
    ),
    humanAttention: trace?.requiresHumanAttention === true,
    engineeringReviewVersion: report.engineeringReview?.version ?? null,
    engineeringDimensions: report.engineeringReview?.dimensions ?? [],
    engineeringRubric: report.engineeringReview?.rubric ?? [],
    engineeringSupport: {
      contextualFacetIds: (report.engineeringReview?.rubric ?? [])
        .filter((facet) => facet.contextualAnalysis?.length)
        .map((facet) => facet.id),
      guidanceOnlyFacetIds: (report.engineeringReview?.rubric ?? [])
        .filter((facet) => !facet.contextualAnalysis?.length)
        .map((facet) => facet.id),
      contextualNarrativesUnverified: (
        report.engineeringReview?.rubric ?? []
      ).every((facet) =>
        (facet.contextualAnalysis ?? []).every(
          (entry) => entry.status === 'UNVERIFIED',
        ),
      ),
      unknownContextualCitations: (report.engineeringReview?.rubric ?? [])
        .flatMap((facet) => facet.contextualAnalysis ?? [])
        .flatMap((entry) => entry.evidence ?? [])
        .filter(
          (citation) =>
            !evidence.some(
              (item) =>
                item.id === citation.evidenceId &&
                item.kind === citation.kind &&
                (item.path ?? null) === citation.path &&
                (item.criterionId ?? null) === citation.criterionId,
            ),
        ),
      rubricCount: report.engineeringReview?.rubric?.length ?? 0,
      parentStatuses: (report.engineeringReview?.dimensions ?? []).map((d) => ({
        dimension: d.dimension,
        facts: d.supportMatrix?.facts?.status ?? 'UNVERIFIED',
        engineeringAssessment:
          d.supportMatrix?.engineeringAssessment?.status ?? 'UNVERIFIED',
        contextualAi: d.supportMatrix?.contextualAi?.status ?? 'UNVERIFIED',
      })),
      arbitraryNarrativesUnverified: (
        report.engineeringReview?.dimensions ?? []
      ).every((d) => d.supportMatrix?.contextualAi?.status === 'UNVERIFIED'),
      unknownFactCitations: (report.engineeringReview?.rubric ?? [])
        .filter((f) => f.status === 'SUPPORTED_FACT')
        .flatMap((f) => f.evidenceIds ?? [])
        .filter(
          (id) =>
            !evidence.some(
              (e) =>
                e.id === id &&
                e.kind === 'execution' &&
                e.status !== 'UNVERIFIED',
            ),
        ),
      semanticFacetsNotPromotedByLint: (report.engineeringReview?.rubric ?? [])
        .filter((f) => !['25.15', '25.16'].includes(f.id))
        .every(
          (f) =>
            f.status === 'UNVERIFIED' &&
            f.inspectReason?.length > 20 &&
            f.requiresHumanInspection === true,
        ),
      privateIntentionUnknown: (report.engineeringReview?.rubric ?? []).some(
        (f) => f.id === '25.18' && f.status === 'UNVERIFIED',
      ),
      criticalMissingAnalysisAttention:
        trace?.qualitativeCriterionAnalysis?.status === 'UNVERIFIED'
          ? trace?.requiresHumanAttention === true
          : null,
    },
  };
  const capture = await call('evaluations/' + id + '/artifacts/retry', {});
  result.artifactRecapture = { status: capture.status, result: capture.value };
  const updated = (await call('evaluations/' + id)).value;
  const artifact = (updated.artifacts ?? []).find((a) => a.status === 'STORED');
  if (artifact) {
    const r = await fetch(
      origin +
        '/api/organization/artifact?key=' +
        encodeURIComponent(artifact.key),
      { headers: { cookie, origin } },
    );
    const b = Buffer.from(await r.arrayBuffer());
    const unauthorized = await fetch(
      origin +
        '/api/organization/artifact?key=' +
        encodeURIComponent(artifact.key),
    );
    result.artifactDownload = {
      status: r.status,
      integrity:
        createHash('sha256').update(b).digest('hex') === artifact.sha256,
      unauthorized: unauthorized.status,
      bytes: b.length,
    };
  }
  await writeFile(
    'docs/qa/current-payment-grounding-' + pr + '.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      runId: id,
      state: result.state,
      aiStatus: result.aiStatus,
      publication: result.publication,
      unsupportedObserved: result.unsupportedObserved,
      criterionConsistency: result.criterionConsistency,
      groundingPolicy: trace?.groundingPolicy,
      model: trace?.model,
      failureCode: trace?.failureCode,
      artifactDownload: result.artifactDownload,
      protectedFailures: result.protectedEvidence.length,
      humanAttention: result.humanAttention,
    }),
  );
  if (
    result.state !== 'COMPLETED' ||
    !['COMPLETED', 'NEEDS_REVIEW'].includes(result.aiStatus) ||
    result.unsupportedObserved ||
    result.unknownCitations.length ||
    !result.criterionConsistency ||
    !trace?.groundingPolicy ||
    !result.artifactDownload?.integrity
  )
    throw Error('CALIBRATION_NOT_VERIFIED');
  if (
    result.aiStatus === 'NEEDS_REVIEW' &&
    (trace?.qualitativeCriterionAnalysis?.status !== 'UNVERIFIED' ||
      !result.humanAttention)
  )
    throw Error('MISSING_AI_ANALYSIS_HIDDEN');
  if (
    ['requirements-and-approach-v10', 'requirements-and-approach-v11'].includes(
      trace?.policy,
    ) &&
    (result.engineeringSupport.rubricCount !== 49 ||
      result.engineeringDimensions.length !== 6 ||
      !result.engineeringSupport.arbitraryNarrativesUnverified ||
      result.engineeringSupport.unknownFactCitations.length ||
      !result.engineeringSupport.semanticFacetsNotPromotedByLint ||
      !result.engineeringSupport.privateIntentionUnknown)
  )
    throw Error('ENGINEERING_MATRIX_NOT_VERIFIED');
  if (
    trace?.policy === 'requirements-and-approach-v11' &&
    (result.engineeringReviewVersion !== 'judge-engineering-dimensions-v2' ||
      !result.engineeringSupport.contextualNarrativesUnverified ||
      result.engineeringSupport.unknownContextualCitations.length ||
      !result.engineeringSupport.contextualFacetIds.length ||
      report.engineeringReview.rubric.find((facet) => facet.id === '25.18')
        ?.contextualAnalysis?.length)
  )
    throw Error('SEMANTIC_PROJECTION_NOT_VERIFIED');
  if (
    pr === 8 &&
    !result.requirements.some((r) =>
      r.criteria.some((c) => c.status === 'FAIL'),
    )
  )
    throw Error('PARTIAL_FAILURE_NOT_VERIFIED');
  if (pr === 9 && !result.protectedEvidence.length)
    throw Error('PROTECTED_TEST_FAILURE_NOT_VERIFIED');
} finally {
  await call('logout', {});
}
