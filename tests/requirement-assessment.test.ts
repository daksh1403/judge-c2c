import { describe, expect, it } from 'vitest';
import { requirementOutcomes } from '../src/requirement-assessment';
import { demoContract } from '../src/demo';
import type { Contract, Evidence } from '../src/domain';
const contract = {
  ...demoContract,
  requirements: [
    {
      id: 'feature',
      title: 'Feature',
      mandatory: true,
      criteria: [
        {
          id: 'first',
          description: 'First',
          kind: 'functional',
          verification: { type: 'human' },
        },
        {
          id: 'second',
          description: 'Second',
          kind: 'functional',
          verification: { type: 'human' },
        },
      ],
    },
  ],
} as Contract;
const item = (
  criterionId: string,
  status: Evidence['status'],
  kind: Evidence['kind'] = 'execution',
): Evidence => ({
  id: criterionId + '-' + status,
  criterionId,
  kind,
  status,
  claim: 'Fixture objective outcome',
});
describe('deterministic requirement aggregation', () => {
  it('never passes empty evidence or functional source-only claims', () => {
    expect(requirementOutcomes(contract, [])[0]?.status).toBe('UNVERIFIED');
    expect(
      requirementOutcomes(contract, [
        item('first', 'PASS', 'source'),
        item('second', 'PASS', 'source'),
      ])[0]?.status,
    ).toBe('UNVERIFIED');
  });
  it('keeps partial completion and missing criteria explicit', () => {
    const result = requirementOutcomes(contract, [item('first', 'PASS')])[0]!;
    expect(result.status).toBe('PARTIAL');
    expect(result.needsAttention).toBe(true);
    expect(result.criteria[1]?.status).toBe('UNVERIFIED');
  });
  it('retains failed criteria and cannot offset them with unrelated extra work', () => {
    const result = requirementOutcomes(contract, [
      item('first', 'PASS'),
      item('second', 'FAIL'),
      item('extra-feature', 'PASS'),
    ])[0]!;
    expect(result.status).toBe('PARTIAL');
    expect(result.criteria[1]?.status).toBe('FAIL');
  });
  it('requires all frozen criteria to pass, and optional requirements remain visible', () => {
    const optional = {
      ...contract,
      requirements: contract.requirements.map((r) => ({
        ...r,
        mandatory: false,
      })),
    };
    expect(
      requirementOutcomes(optional, [
        item('first', 'PASS'),
        item('second', 'PASS'),
      ])[0],
    ).toMatchObject({
      status: 'PASS',
      mandatory: false,
      needsAttention: false,
    });
  });
  it('fails closed on contradictory objective results', () => {
    const result = requirementOutcomes(contract, [
      item('first', 'PASS'),
      item('first', 'FAIL'),
    ])[0]!;
    expect(result.status).toBe('FAIL');
    expect(result.criteria[0]?.reason).toContain('Conflicting');
  });
});

it.each(['FAIL', 'UNVERIFIED'] as const)(
  'preserves PARTIAL requirement projection and overall failure/attention precedence when another criterion is %s despite optimistic AI prose',
  async (other) => {
    const { deterministicReport } = await import('../src/evaluate');
    const { groundReview } = await import('../src/claim-grounding');
    const { checkBody } = await import('../src/github-checks');
    const facts = [item('first', 'PASS'), item('second', other)];
    const original = deterministicReport(contract, facts);
    original.summary = 'All requirements passed.';
    original.assessments = original.assessments.map((a) => ({
      ...a,
      status: 'PASS',
    }));
    const grounded = groundReview(original, contract, facts);
    expect(requirementOutcomes(contract, facts)[0]).toMatchObject({
      status: 'PARTIAL',
      mandatory: true,
      needsAttention: true,
    });
    expect(grounded.review.assessments.map((a) => a.status)).toEqual([
      'PASS',
      other,
    ]);
    expect(grounded.review.summary).not.toBe('All requirements passed.');
    const run = {
      id: '1'.repeat(64),
      head_sha: 'b'.repeat(40),
      baseline_sha: contract.baseline,
      contract_hash: 'c'.repeat(64),
      contract_snapshot: JSON.stringify(contract),
      state: 'COMPLETED',
      evidence: JSON.stringify(facts),
      report: JSON.stringify(grounded.review),
      ai_status: 'COMPLETED',
    } as unknown as import('../src/store').Run;
    expect(checkBody({}, run).conclusion).toBe(
      other === 'FAIL' ? 'failure' : 'action_required',
    );
  },
);
