import { it, expect } from 'vitest';
import { retryableRun } from '../src/retry-policy';
import { AI_POLICY_VERSION } from '../src/evaluate';
it('allows new attempts after execution outage but never rewrites or retries current valid completed work', () => {
  const run = {
    state: 'COMPLETED' as const,
    ai_status: 'COMPLETED',
    report: JSON.stringify({ aiTrace: { policy: AI_POLICY_VERSION } }),
    evidence: JSON.stringify([
      { id: 'runner-stage', kind: 'execution', status: 'UNVERIFIED' },
    ]),
  };
  expect(retryableRun(run)).toBe(true);
  expect(retryableRun({ ...run, state: 'SUPERSEDED' })).toBe(false);
  expect(
    retryableRun({
      ...run,
      evidence: JSON.stringify([
        { id: 'manual', kind: 'policy', status: 'UNVERIFIED' },
      ]),
    }),
  ).toBe(false);
  expect(
    retryableRun({
      ...run,
      evidence: JSON.stringify([
        { id: 'criterion', kind: 'execution', status: 'FAIL' },
      ]),
    }),
  ).toBe(false);
  expect(
    retryableRun({
      ...run,
      evidence: JSON.stringify([
        { id: 'criterion', kind: 'execution', status: 'UNVERIFIED' },
      ]),
    }),
  ).toBe(true);
});
