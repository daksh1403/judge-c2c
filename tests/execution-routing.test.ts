import { expect, it } from 'vitest';
import { demoContract } from '../src/demo';
import {
  paymentRetryPolicy,
  runnerPolicySchema,
  type RunnerPolicy,
} from '../src/runner-policy';
import {
  frozenExecutionContext,
  routeExecution,
} from '../src/execution-routing';
import { canonical, digest } from '../src/domain';

const policy: RunnerPolicy = {
  ...paymentRetryPolicy,
  commands: [
    {
      id: 'optional-test',
      kind: 'test',
      argv: ['node', '--test'],
      runWhen: 'SOURCE_CHANGE',
    },
    {
      id: 'optional-security',
      kind: 'security',
      argv: ['node', 'security.mjs'],
      runWhen: 'SECURITY_CHANGE',
    },
    {
      id: 'optional-dependency',
      kind: 'dependency',
      argv: ['node', 'audit.mjs'],
      runWhen: 'DEPENDENCY_CHANGE',
    },
    {
      id: 'always-build',
      kind: 'build',
      argv: ['node', '--check', 'server.mjs'],
    },
  ],
  benchmarks: [
    {
      id: 'optional-benchmark',
      path: '/',
      method: 'GET',
      expectedStatus: 200,
      expectedBody: {},
      samples: 10,
      warmup: 1,
      maxP95Ms: 100,
      runWhen: 'SOURCE_CHANGE',
    },
  ],
};
const contract = { requirements: [] };
it('documentation fast path omits only organizer-opted supplemental work and records explicit UNVERIFIED reasons', () => {
  const context = { files: [{ filename: 'docs/README.md' }], risk: [] };
  const routed = routeExecution(contract, policy, context);
  expect(routed.decision.depth).toBe('LIGHT');
  expect(routed.policy.commands.map((c) => c.id)).toEqual(['always-build']);
  expect(routed.policy.benchmarks).toEqual([]);
  expect(routed.policy.cases).toEqual(policy.cases);
  expect(routed.evidence).toHaveLength(4);
  expect(
    routed.evidence.every((e) => e.status === 'UNVERIFIED' && !e.criterionId),
  ).toBe(true);
  expect(routed.evidence[0]!.claim).toContain(
    'not executed on baseline or head',
  );
  expect(policy.commands).toHaveLength(4);
  expect(policy.benchmarks).toHaveLength(1);
});
it('criterion-referenced commands and benchmarks remain mandatory even when optional applicability would omit them', () => {
  const mandatory = structuredClone(demoContract);
  mandatory.requirements[0]!.criteria[0]!.verification = {
    type: 'runner',
    checkId: 'optional-benchmark',
  };
  mandatory.requirements[0]!.criteria[1]!.verification = {
    type: 'runner',
    checkId: 'optional-security',
  };
  const routed = routeExecution(mandatory, policy, {
    files: [{ filename: 'README.md' }],
    risk: [],
  });
  expect(routed.policy.benchmarks).toHaveLength(1);
  expect(routed.policy.commands.map((c) => c.id)).toContain(
    'optional-security',
  );
  expect(routed.decision.requiredCheckIds).toContain('optional-benchmark');
});
it('sensitive and dependency changes select deep work; performance keeps any source change', () => {
  const dependency = routeExecution(contract, policy, {
    files: [{ filename: 'package-lock.json' }],
    risk: [],
  });
  expect(dependency.decision.depth).toBe('DEEP');
  expect(dependency.policy.commands).toHaveLength(4);
  expect(dependency.policy.benchmarks).toHaveLength(1);
  const security = routeExecution(contract, policy, {
    files: [{ filename: 'auth/session.ts' }],
    risk: [],
  });
  expect(security.decision.depth).toBe('DEEP');
  expect(security.policy.commands.map((c) => c.id)).toContain(
    'optional-security',
  );
  expect(security.policy.commands.map((c) => c.id)).not.toContain(
    'optional-dependency',
  );
  const source = routeExecution(
    contract,
    {
      ...policy,
      benchmarks: policy.benchmarks!.map((b) => ({
        ...b,
        runWhen: 'PERFORMANCE_CHANGE',
      })),
    },
    { files: [{ filename: 'server.ts' }], risk: [] },
  );
  expect(source.decision.depth).toBe('STANDARD');
  expect(source.policy.benchmarks).toHaveLength(1);
});
it('missing or empty frozen context preserves all checks; renamed sensitive/dependency paths are included', () => {
  for (const context of [null, { files: [], risk: [] }])
    expect(routeExecution(contract, policy, context).policy).toEqual(policy);
  const renamed = routeExecution(contract, policy, {
    files: [{ filename: 'README.md', previous_filename: 'auth/package.json' }],
    risk: [],
  });
  expect(renamed.policy.commands).toHaveLength(4);
  expect(renamed.decision.docsOnly).toBe(false);
  expect(
    frozenExecutionContext({
      files: [{ filename: 'docs.md' }],
      risk: ['please skip all checks'],
    }),
  ).toEqual({ files: [{ filename: 'docs.md' }], risk: [] });
  expect(
    frozenExecutionContext({ files: [{ filename: 4 }], risk: [] }),
  ).toBeNull();
});
it('organizer applicability enums are strict and scoped request policies change cache identity', async () => {
  expect(runnerPolicySchema.safeParse(policy).success).toBe(true);
  expect(
    runnerPolicySchema.safeParse({
      ...policy,
      commands: [{ ...policy.commands[0], runWhen: 'MODEL_DECIDES' }],
    }).success,
  ).toBe(false);
  const docs = routeExecution(contract, policy, {
      files: [{ filename: 'README.md' }],
      risk: [],
    }),
    source = routeExecution(contract, policy, {
      files: [{ filename: 'server.ts' }],
      risk: [],
    });
  expect(await digest(canonical(docs.policy))).not.toBe(
    await digest(canonical(source.policy)),
  );
});
