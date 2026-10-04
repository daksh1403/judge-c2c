import { describe, it, expect } from 'vitest';
import {
  groundReview,
  GROUNDING_POLICY,
  completeObjectiveAssessments,
} from '../src/claim-grounding';
import { demoContract } from '../src/demo';
import { deterministicReport, aiReview } from '../src/evaluate';
import { validateReview, type Evidence } from '../src/domain';
function fixture() {
  const contract = structuredClone(demoContract);
  contract.requirements = [
    {
      id: 'retry',
      title: 'Bound retries',
      mandatory: true,
      criteria: [
        {
          id: 'retry-bounded',
          description: 'Bound attempts',
          kind: 'functional',
          verification: { type: 'runner', checkId: 'retry-bounded' },
        },
      ],
    },
  ];
  const evidence: Evidence[] = [
    {
      id: 'bounded',
      kind: 'execution',
      criterionId: 'retry-bounded',
      status: 'FAIL',
      baselineStatus: 'FAIL',
      claim: 'Trusted retry-bounded acceptance check: FAIL.',
    },
    {
      id: 'source',
      kind: 'source',
      status: 'PASS',
      claim:
        'Exact baseline/head source retrieved for contextual inspection only; presence is not functional proof.',
    },
  ];
  return {
    contract,
    evidence,
    review: deterministicReport(contract, evidence),
  };
}
describe('AI facts and unverified narratives', () => {
  it('flags the known false-coverage class even when it is valid cited INFERENCE', () => {
    const { contract, evidence, review } = fixture();
    review.solution_approach.maintainability = {
      text: 'No test covers bound retries.',
      evidenceIds: ['source'],
      verification: 'INFERENCE',
    };
    review.solution_approach.evidence = ['source'];
    const output = groundReview(
      validateReview(review, contract, evidence),
      contract,
      evidence,
    );
    expect(output.review.solution_approach.maintainability.verification).toBe(
      'INFERENCE',
    );
    expect(output.grounding.unverifiedNarrativePaths).toContain(
      'solution_approach.maintainability',
    );
    expect(output.grounding.requiresHumanAttention).toBe(true);
    expect(output.review.assessments[0]?.status).toBe('FAIL');
    expect(output.grounding.groundingPolicy).toBe(GROUNDING_POLICY);
  });
  it('downgrades unsupported OBSERVED prose and keeps exact criterion execution facts', () => {
    const { contract, evidence, review } = fixture();
    review.solution_approach.maintainability = {
      text: 'No tests exist.',
      evidenceIds: ['source'],
      verification: 'OBSERVED',
    };
    review.solution_approach.correctness = {
      text: evidence[0]!.claim,
      evidenceIds: ['bounded'],
      verification: 'OBSERVED',
    };
    review.solution_approach.evidence = ['source', 'bounded'];
    const output = groundReview(
      validateReview(review, contract, evidence),
      contract,
      evidence,
    );
    expect(output.review.solution_approach.maintainability.verification).toBe(
      'UNVERIFIED',
    );
    expect(output.review.solution_approach.correctness.verification).toBe(
      'OBSERVED',
    );
    expect(output.grounding.downgradedObservationPaths).toEqual([
      'solution_approach.maintainability',
    ]);
  });
  it('replaces model assessment prose and summary without changing input or inventing facts', () => {
    const { contract, evidence, review } = fixture();
    review.assessments[0]!.explanation = 'The participant is incompetent.';
    review.summary = 'Everything is perfect.';
    const before = structuredClone(review);
    const output = groundReview(
      validateReview(review, contract, evidence),
      contract,
      evidence,
    );
    expect(output.review.summary).toContain('1 FAIL');
    expect(output.review.assessments[0]!.explanation).not.toContain(
      'incompetent',
    );
    expect(review).toEqual(before);
  });
  it('retains objective failure when a second check passes the same criterion', () => {
    const { contract, evidence, review } = fixture();
    evidence.unshift({ ...evidence[0]!, id: 'pass', status: 'PASS' });
    review.assessments[0]!.status = 'PASS';
    review.assessments[0]!.evidenceIds = ['pass'];
    expect(() => validateReview(review, contract, evidence)).toThrow(
      'AI cannot override objective failure',
    );
  });
});

it('fills missing criterion echoes from objective evidence, preserves input and rejects model contradictions', () => {
  const { contract, evidence, review } = fixture();
  review.assessments = [];
  const completed = completeObjectiveAssessments(review, contract, evidence);
  expect(completed.filledCriterionIds).toEqual(['retry-bounded']);
  expect(
    validateReview(completed.value, contract, evidence).assessments[0]?.status,
  ).toBe('FAIL');
  expect(review.assessments).toEqual([]);
  review.assessments = [
    {
      criterionId: 'retry-bounded',
      status: 'PASS',
      explanation: 'all good',
      evidenceIds: ['bounded'],
    },
  ];
  expect(() =>
    validateReview(
      completeObjectiveAssessments(review, contract, evidence).value,
      contract,
      evidence,
    ),
  ).toThrow('AI cannot override objective failure');
});

it('keeps incomplete qualitative AI review NEEDS_REVIEW after objective-only recovery', async () => {
  const { contract, evidence, review } = fixture();
  review.assessments = [];
  const output = await aiReview(
    {
      AI_PROVIDER: 'cloudflare',
      AI_MODEL: 'synthetic/model',
      AI: { run: async () => ({ response: review }) },
    } as unknown as import('../src/env').Env,
    contract,
    {
      files: [],
      sources: {},
      risk: [],
      environment: 'test',
      toolVersion: 'test',
    },
    evidence,
  );
  expect(output.status).toBe('NEEDS_REVIEW');
  expect(output.review.assessments[0]?.status).toBe('FAIL');
  expect(output.trace).toMatchObject({
    requiresHumanAttention: true,
    objectiveCriterionRecovery: ['retry-bounded'],
    qualitativeCriterionAnalysis: {
      status: 'UNVERIFIED',
      missingCriterionIds: ['retry-bounded'],
    },
  });
});
