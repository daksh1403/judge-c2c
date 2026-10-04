import { it, expect } from 'vitest';
import { providerReviewSchema } from '../src/provider-review-schema';
import { demoContract } from '../src/demo';
it('constrains generated citations and criterion count but leaves semantic correctness to local validation', () => {
  const schema = providerReviewSchema(demoContract, [
    { id: 'trusted', kind: 'execution', status: 'FAIL', claim: 'failed' },
  ]);
  expect(schema.$defs.evidenceId.enum).toEqual(['trusted']);
  expect(schema.properties.assessments.minItems).toBe(
    demoContract.requirements.flatMap((r) => r.criteria).length,
  );
  expect(
    schema.properties.assessments.items.properties.evidenceIds.items,
  ).toEqual({ $ref: '#/$defs/evidenceId' });
  expect(
    schema.properties.assessments.items.properties.criterionId.enum,
  ).toEqual(
    demoContract.requirements.flatMap((r) => r.criteria.map((c) => c.id)),
  );
});
