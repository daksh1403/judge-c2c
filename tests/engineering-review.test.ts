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
