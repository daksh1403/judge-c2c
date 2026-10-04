import { it, expect } from 'vitest';
import { operationalAlerts } from '../src/operational-alerts';
it('signals only recorded failures and keeps recovery distinct from judging', () => {
  expect(operationalAlerts([])).toEqual([]);
  const alerts = operationalAlerts([
    { metric: 'github.error', count: 2, sum: 2, max: 1 },
    { metric: 'runner.durationMs', count: 1, sum: 100, max: 100 },
  ]);
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toMatchObject({ metric: 'github.error', observed: 2 });
  expect(alerts[0]?.action).toContain('recovery');
});
