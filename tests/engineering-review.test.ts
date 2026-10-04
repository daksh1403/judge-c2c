import { expect, it } from 'vitest';
import { demoContract } from '../src/demo';
import { paymentRetryPolicy } from '../src/runner-policy';
import { deterministicReport } from '../src/evaluate';
import { enrichEngineeringReview } from '../src/engineering-review';
import { groundReview } from '../src/claim-grounding';
import type { Evidence } from '../src/domain';

function fixture() {
  const contract = structuredClone(demoContract);
  contract.execution.runner = {
    ...paymentRetryPolicy,
    commands: [
      { id: 'lint', kind: 'lint', argv: ['node', 'lint.mjs'] },
      { id: 'security', kind: 'security', argv: ['node', 'scan.mjs'] },
      { id: 'coverage', kind: 'coverage', argv: ['node', 'coverage.mjs'] },
    ],
    benchmarks: [
      {
        id: 'speed',
        path: '/',
        method: 'GET',
        expectedStatus: 200,
        expectedBody: {},
        samples: 10,
        warmup: 1,
        maxP95Ms: 100,
      },
    ],
  };
  contract.requirements = [
    {
      id: 'retry',
      title: 'Retry',
      mandatory: true,
      criteria: [
        {
          id: 'bounded',
          description: 'Bound attempts',
          kind: 'functional',
          verification: { type: 'runner', checkId: 'retry-bounded' },
        },
      ],
    },
  ];
  const evidence: Evidence[] = [
    {
      id: 'criterion',
      kind: 'execution',
      criterionId: 'bounded',
      status: 'PASS',
      baselineStatus: 'FAIL',
      claim: 'Trusted retry-bounded check passed.',
    },
    {
      id: 'execution-lint',
      kind: 'execution',
      status: 'FAIL',
      baselineStatus: 'PASS',
      claim: 'Lint failed.',
    },
    {
      id: 'source',
      kind: 'source',
      path: 'server.mjs',
      status: 'PASS',
      claim: 'Source retrieved.',
    },
    {
      id: 'dependency-advisory',
      kind: 'source',
      status: 'FAIL',
      claim: 'Version matches advisory metadata; exploitability unknown.',
    },
  ];
  const review = deterministicReport(contract, evidence);
  review.findings = [
    {
      category: 'quality',
      severity: 'high',
      claim: 'Consider duplication.',
      evidenceIds: ['criterion', 'source'],
      verification: 'inference',
    },
  ];
  return { contract, evidence, review };
}
it('derives finding origin/source/requirement links from known criterion evidence only without changing grounding', () => {
  const { contract, evidence, review } = fixture();
  const grounded = groundReview(review, contract, evidence);
  const original = structuredClone(grounded);
  const enriched = enrichEngineeringReview(contract, evidence, grounded.review);
  expect(enriched.findingsProvenance[0]).toMatchObject({
    origin: 'AI_ASSESSMENT',
    relatedRequirementIds: ['retry'],
    sourcePaths: ['server.mjs'],
    verification: 'UNVERIFIED',
    dimension: 'QUALITY',
  });
  expect(grounded).toEqual(original);
  review.findings[0]!.evidenceIds = ['source', 'made-up'];
  expect(
    enrichEngineeringReview(contract, evidence, review).findingsProvenance[0],
  ).toMatchObject({
    relatedRequirementIds: [],
    requirementLinkStatus: 'UNVERIFIED',
    evidenceIds: ['source'],
  });
});
it('shows six dimensions with measured check deltas and explicit missing capabilities rather than blanket PASS', () => {
  const { contract, evidence, review } = fixture();
  const result = enrichEngineeringReview(contract, evidence, review);
  const dims = result.engineeringReview.dimensions;
  expect(dims.map((d) => d.dimension)).toEqual([
    'QUALITY',
    'ARCHITECTURE',
    'SECURITY',
    'PERFORMANCE',
    'TESTING',
    'MAINTAINABILITY',
  ]);
  expect(dims.find((d) => d.dimension === 'QUALITY')!.checks[0]).toMatchObject({
    checkId: 'lint',
    status: 'FAIL',
    baselineStatus: 'PASS',
    delta: 'REGRESSION',
  });
  expect(
    dims
      .find((d) => d.dimension === 'TESTING')!
      .checks.find((c) => c.checkId === 'retry-bounded'),
  ).toMatchObject({
    status: 'PASS',
    baselineStatus: 'FAIL',
    delta: 'IMPROVEMENT',
  });
  for (const dim of dims) {
    expect(dim.status).not.toBe('PASS');
    expect(
      dim.missingCapabilities.every((m) => m.status === 'UNVERIFIED'),
    ).toBe(true);
  }
  expect(dims.find((d) => d.dimension === 'SECURITY')!).toMatchObject({
    status: 'UNVERIFIED',
    contextualEvidenceIds: ['dependency-advisory'],
  });
  expect(
    dims.find((d) => d.dimension === 'PERFORMANCE')!.checks[0],
  ).toMatchObject({ status: 'UNVERIFIED', delta: 'UNVERIFIED' });
});
it('does not count source presence, routing omissions, AI prose or unknown check IDs as observed execution', () => {
  const { contract, evidence, review } = fixture();
  evidence.push(
    {
      id: 'execution-routing-security',
      kind: 'execution',
      status: 'UNVERIFIED',
      claim: 'Security not executed.',
    },
    {
      id: 'execution-invented',
      kind: 'execution',
      status: 'PASS',
      claim: 'Everything secure.',
    },
  );
  review.findings[0]!.category = 'security';
  review.findings[0]!.claim = 'All vulnerabilities fixed.';
  const security = enrichEngineeringReview(
    contract,
    evidence,
    review,
  ).engineeringReview.dimensions.find((d) => d.dimension === 'SECURITY')!;
  expect(security.counts).toEqual({ PASS: 0, FAIL: 0, UNVERIFIED: 1 });
  expect(security.findingIndexes).toEqual([0]);
  expect(security.status).toBe('UNVERIFIED');
});

it('classifies compatible objective facts and safe server coverage assessments while rejecting arbitrary model prose', () => {
  const { contract, evidence, review } = fixture();
  review.findings[0]!.claim =
    'Architecture is perfect; all authentication attacks are prevented.';
  const dims = enrichEngineeringReview(contract, evidence, review)
    .engineeringReview.dimensions;
  const quality = dims.find((d) => d.dimension === 'QUALITY')!;
  expect(quality.supportMatrix.facts).toMatchObject({
    status: 'SUPPORTED_FACT',
    scope: 'configured-check-outcomes-only',
    evidenceIds: ['execution-lint'],
  });
  expect(quality.supportMatrix.engineeringAssessment).toMatchObject({
    status: 'SUPPORTED_ENGINEERING_ASSESSMENT',
    origin: 'SERVER_EVIDENCE_COVERAGE_ASSESSMENT',
    checkIds: ['lint'],
    requiresHumanInspection: true,
  });
  expect(quality.supportMatrix.engineeringAssessment.text).toContain(
    'regression',
  );
  const architecture = dims.find((d) => d.dimension === 'ARCHITECTURE')!;
  expect(architecture.supportMatrix.facts.status).toBe('UNVERIFIED');
  expect(architecture.supportMatrix.engineeringAssessment.status).toBe(
    'UNVERIFIED',
  );
  const security = dims.find((d) => d.dimension === 'SECURITY')!;
  expect(security.supportMatrix.facts.status).toBe('UNVERIFIED');
  expect(security.supportMatrix.engineeringAssessment.text).toContain(
    'lack verified results',
  );
  for (const dimension of dims)
    expect(dimension.supportMatrix.contextualAi.status).toBe('UNVERIFIED');
  expect(JSON.stringify(dims)).not.toContain('all authentication attacks');
});

it('covers all49 review facets explicitly without inheriting unrelated lint outcomes', () => {
  const { contract, evidence, review } = fixture();
  const rubric = enrichEngineeringReview(contract, evidence, review)
    .engineeringReview.rubric;
  expect(rubric).toHaveLength(49);
  expect(new Set(rubric.map((r) => r.id)).size).toBe(49);
  for (const id of ['27.02', '27.05', '28.03', '29.03', '25.13'])
    expect(rubric.find((r) => r.id === id)).toMatchObject({
      status: 'UNVERIFIED',
      requiresHumanInspection: true,
      evidenceIds: [],
    });
  expect(rubric.find((r) => r.id === '25.15')).toMatchObject({
    status: 'SUPPORTED_FACT',
    scope: 'configured-baseline-head-check-deltas-only',
  });
  expect(
    rubric.every(
      (r) =>
        r.aiNarrativeStatus === 'UNVERIFIED' && r.inspectReason.length > 20,
    ),
  ).toBe(true);
});

it('projects specific contextual observations and finding indexes with exact server-owned citations without semantic promotion', () => {
  const { contract, evidence, review } = fixture();
  review.solution_approach.problem_understanding = {
    text: 'The required payment retry must stop at the frozen attempt bound.',
    evidenceIds: ['criterion'],
    verification: 'UNVERIFIED',
  };
  review.solution_approach.unverified_assumptions = [
    {
      text: 'The assumption that invalid input cannot reach the retry loop requires inspection.',
      evidenceIds: ['source', 'criterion'],
      verification: 'UNVERIFIED',
    },
  ];
  review.findings = [
    {
      category: 'security',
      severity: 'high',
      claim:
        'Input validation should reject an invalid attempt count at the request boundary.',
      evidenceIds: ['source', 'criterion'],
      verification: 'inference',
    },
  ];
  const result = enrichEngineeringReview(contract, evidence, review);
  const validation = result.engineeringReview.rubric.find(
    (r) => r.id === '28.02',
  )!;
  expect(validation.status).toBe('UNVERIFIED');
  expect(validation.analysisCoverage).toBe('CONTEXTUAL_ANALYSIS_AVAILABLE');
  const finding = validation.contextualAnalysis.find(
    (a) => a.findingIndex === 0,
  )!;
  expect(finding).toMatchObject({
    status: 'UNVERIFIED',
    relevanceBasis: 'EXPLICIT_TOPIC_MATCH',
    findingIndex: 0,
    observationPath: null,
  });
  expect(finding.evidence).toEqual([
    {
      evidenceId: 'source',
      kind: 'source',
      status: 'PASS',
      path: 'server.mjs',
      criterionId: null,
      requirementId: null,
      checkId: null,
      checkKind: null,
      scope: 'CITED_CONTEXT_ONLY',
    },
    {
      evidenceId: 'criterion',
      kind: 'execution',
      status: 'PASS',
      path: null,
      criterionId: 'bounded',
      requirementId: 'retry',
      checkId: 'retry-bounded',
      checkKind: 'acceptance',
      scope: 'CONFIGURED_CHECK_ONLY',
    },
  ]);
  expect(
    result.engineeringReview.rubric.find((r) => r.id === '25.01')!
      .contextualAnalysis[0]!.observationPath,
  ).toBe('solution_approach.problem_understanding');
  expect(
    result.engineeringReview.rubric
      .find((r) => r.id === '25.10')!
      .contextualAnalysis.some(
        (a) =>
          a.observationPath === 'solution_approach.unverified_assumptions[0]',
      ),
  ).toBe(true);
  expect(
    result.engineeringReview.rubric.find((r) => r.id === '28.03')!
      .analysisCoverage,
  ).toBe('MISSING_MEANINGFUL_ANALYSIS');
});

it('keeps uncited, unknown-citation, irrelevant and deterministic boilerplate out of contextual facet coverage', () => {
  const { contract, evidence, review } = fixture();
  review.solution_approach.maintainability = {
    text: 'Maintainability is excellent and all concerns are fixed.',
    evidenceIds: ['invented'],
    verification: 'UNVERIFIED',
  };
  review.findings = [
    {
      category: 'security',
      severity: 'high',
      claim: 'All authentication is secure because lint passed.',
      evidenceIds: ['invented', 'execution-lint'],
      verification: 'inference',
    },
  ];
  const rubric = enrichEngineeringReview(contract, evidence, review)
    .engineeringReview.rubric;
  expect(rubric.find((r) => r.id === '27.01')!.contextualAnalysis).toEqual([]);
  expect(rubric.find((r) => r.id === '28.03')!.contextualAnalysis).toEqual([]);
  expect(rubric.find((r) => r.id === '25.18')).toMatchObject({
    status: 'UNVERIFIED',
    analysisCoverage: 'MISSING_MEANINGFUL_ANALYSIS',
    contextualAnalysis: [],
  });
  review.findings[0]!.evidenceIds = ['execution-lint'];
  const auth = enrichEngineeringReview(
    contract,
    evidence,
    review,
  ).engineeringReview.rubric.find((r) => r.id === '28.03')!;
  expect(auth.status).toBe('UNVERIFIED');
  expect(auth.contextualAnalysis[0]!.evidence[0]!.scope).toBe(
    'CONFIGURED_CHECK_ONLY',
  );
  expect(
    enrichEngineeringReview(
      contract,
      evidence,
      review,
      'DETERMINISTIC_POLICY',
    ).engineeringReview.rubric.every((r) => r.contextualAnalysis.length === 0),
  ).toBe(true);
});

it('never treats diff metadata and failed execution as semantic facts or working behavior', () => {
  const { contract, review } = fixture();
  const evidence: Evidence[] = [
    {
      id: 'diff',
      kind: 'diff',
      status: 'PASS',
      claim:
        'Exact baseline-to-head comparison: 2 changed files. This confirms change metadata, not functionality.',
    },
    {
      id: 'failed',
      kind: 'execution',
      criterionId: 'bounded',
      status: 'FAIL',
      claim: 'Trusted configured test failed.',
    },
  ];
  const rubric = enrichEngineeringReview(contract, evidence, review)
    .engineeringReview.rubric;
  for (const facet of rubric.filter(
    (facet) => !['25.15', '25.16'].includes(facet.id),
  )) {
    expect(facet.status).toBe('UNVERIFIED');
    expect(facet.needsReview).toBe(true);
    expect(facet.boundedAnalysis?.assessment ?? '').not.toContain(
      'implementation addresses test cases',
    );
  }
  expect(
    rubric.find((facet) => facet.id === '25.05')?.boundedAnalysis,
  ).toMatchObject({ status: 'CONCERN', evidenceIds: ['failed'] });
  expect(rubric.find((facet) => facet.id === '27.03')).toMatchObject({
    analysisCoverage: 'MISSING_MEANINGFUL_ANALYSIS',
    evidenceIds: [],
  });
});

it('inspects actual frozen patches without promoting bounded assessments to facts', () => {
  const { contract, evidence, review } = fixture();
  review.findings = [];
  evidence.push({
    id: 'diff',
    kind: 'diff',
    status: 'PASS',
    claim: 'Comparison metadata only',
  });
  const files = [
    {
      filename: 'server.mjs',
      status: 'modified',
      additions: 3,
      deletions: 0,
      patch:
        '+const x = calculate();\n+const x = calculate();\n+const x = calculate();',
    },
  ];
  const facet = enrichEngineeringReview(
    contract,
    evidence,
    review,
    'AI_ASSESSMENT',
    { files },
  ).engineeringReview.rubric.find((facet) => facet.id === '27.03')!;
  expect(facet).toMatchObject({
    status: 'UNVERIFIED',
    needsReview: true,
    evidenceIds: ['diff'],
    analysisCoverage: 'BOUNDED_ANALYSIS_AVAILABLE',
    boundedAnalysis: { status: 'CONCERN' },
  });
  expect(facet.boundedAnalysis?.assessment).toContain('repeated code blocks');
  const incomplete = enrichEngineeringReview(
    contract,
    evidence,
    review,
    'AI_ASSESSMENT',
    { files: [{ ...files[0]!, patchTruncated: true }] },
  ).engineeringReview.rubric.find((facet) => facet.id === '27.03')!;
  expect(incomplete).toMatchObject({
    status: 'UNVERIFIED',
    needsReview: true,
    analysisCoverage: 'MISSING_MEANINGFUL_ANALYSIS',
    evidenceIds: [],
  });
});
