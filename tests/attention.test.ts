import { it, expect } from 'vitest';
import { attentionItems } from '../src/attention';
it('explains automation boundaries and available actions without converting suspicion to exploitability', () => {
  const items = attentionItems(
    {
      state: 'COMPLETED',
      ai_status: 'COMPLETED',
      report: JSON.stringify({
        aiTrace: {
          groundingPolicy: 'objective-facts-unverified-narratives-v1',
          requiresHumanAttention: true,
        },
      }),
    },
    [
      {
        id: 'policy-test',
        kind: 'policy',
        status: 'FAIL',
        claim: 'Protected test changed',
      },
      {
        id: 'dependency-audit',
        kind: 'source',
        status: 'UNVERIFIED',
        claim: 'scanner unavailable',
      },
      {
        id: 'criterion-a',
        kind: 'execution',
        status: 'UNVERIFIED',
        claim: 'install failed',
      },
    ],
  );
  expect(items.map((i) => i.code)).toEqual([
    'AI_CLAIMS_UNVERIFIED',
    'PROTECTED_PATH_CHANGED',
    'SECURITY_REVIEW',
    'EXECUTION_UNVERIFIED',
  ]);
  expect(
    items.every((i) => i.what && i.why && i.inspect.length && i.action),
  ).toBe(true);
  expect(items.find((i) => i.code === 'SECURITY_REVIEW')?.why).toContain(
    'do not establish exploitability',
  );
});
