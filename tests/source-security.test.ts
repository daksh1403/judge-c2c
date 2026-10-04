import { it, expect } from 'vitest';
import { sourceSecurity } from '../src/source-security';
it('compares source patterns without claiming vulnerability certainty or exposing key values', () => {
  const r = sourceSecurity({
    files: [],
    sources: {
      'server.mjs': {
        baseline: 'eval(input);',
        head: 'eval(input);\nconst key="-----BEGIN PRIVATE KEY----- secret-value";',
      },
    },
    risk: [],
    environment: 'fixture',
    toolVersion: 'v1',
  });
  expect(r).toHaveLength(2);
  expect(r[0]).toMatchObject({
    status: 'UNVERIFIED',
    baselineStatus: 'UNVERIFIED',
  });
  // The unterminated private-key marker makes baseline/head attribution incomplete.
  expect(r[1]).toMatchObject({
    status: 'UNVERIFIED',
    baselineStatus: 'UNVERIFIED',
  });
  expect(r[1]!.claim).toContain('comparison incomplete');
  expect(JSON.stringify(r)).not.toContain('secret-value');
  expect(r[1]!.claim).toContain('lines 2');
});
it('does not claim vulnerability-free code when no supported pattern is found', () => {
  expect(
    sourceSecurity({
      files: [],
      sources: { 'server.mjs': { baseline: null, head: 'const x=1;' } },
      risk: [],
      environment: 'fixture',
      toolVersion: 'v1',
    }),
  ).toEqual([]);
});
