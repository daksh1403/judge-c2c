import { describe, expect, it } from 'vitest';
import { assertRunnerIdentity, actionsConfig } from '../src/actions-runner';
import type { Env } from '../src/env';
const env = {
  RUNNER_ACTIONS_REPOSITORY: 'owner/public-runner',
  RUNNER_ACTIONS_REPOSITORY_ID: '123',
  RUNNER_ACTIONS_REF: 'main',
  RUNNER_ACTIONS_SHA: 'a'.repeat(40),
  RUNNER_ACTIONS_ORIGIN: 'https://judge.example.com',
  RUNNER_IMAGE_URI: 'qemu-vm@sha256:' + 'b'.repeat(64),
} as Env;
const claims = {
  repository: 'owner/public-runner',
  repository_id: '123',
  workflow_ref:
    'owner/public-runner/.github/workflows/evaluate.yml@refs/heads/main',
  workflow_sha: 'a'.repeat(40),
  event_name: 'workflow_dispatch',
  run_id: '456',
  run_attempt: '1',
};
describe('Actions execution trust identity', () => {
  it('pins repo ID, workflow path, SHA, event and run identity', () => {
    expect(assertRunnerIdentity(env, claims)).toEqual({
      runId: '456',
      runAttempt: '1',
    });
    for (const [field, value] of Object.entries({
      repository: 'attacker/repo',
      repository_id: '999',
      workflow_ref:
        'owner/public-runner/.github/workflows/evil.yml@refs/heads/main',
      workflow_sha: 'c'.repeat(40),
      event_name: 'pull_request',
      run_id: '../456',
      run_attempt: '0',
    }))
      expect(() =>
        assertRunnerIdentity(env, { ...claims, [field]: value }),
      ).toThrow();
  });
  it('requires explicit immutable environment and HTTPS audience', () => {
    expect(actionsConfig(env).origin).toBe('https://judge.example.com');
    expect(() =>
      actionsConfig({ ...env, RUNNER_ACTIONS_ORIGIN: 'http://local' }),
    ).toThrow();
    expect(() =>
      actionsConfig({ ...env, RUNNER_ACTIONS_SHA: undefined }),
    ).toThrow();
    expect(() =>
      actionsConfig({ ...env, RUNNER_IMAGE_URI: 'UNCONFIGURED' }),
    ).toThrow();
  });
});

it('fences claims, completed replay, expiration and immutable inputs in real D1', async () => {
  const { Miniflare } = await import('miniflare');
  const { migrate } = await import('./database');
  const { actionsBroker } = await import('../src/actions-runner');
  const { canonical, digest } = await import('../src/domain');
  const { RUNNER_VERSION } = await import('../src/runner-policy');
  const mf = new Miniflare({
    modules: true,
    script: 'export default {}',
    d1Databases: ['DB'],
    compatibilityDate: '2026-08-01',
  });
  try {
    const db = (await mf.getD1Database('DB')) as unknown as D1Database;
    await migrate(db);
    const runtime = {
      ...env,
      DB: db,
      RUNNER_ENABLED: 'true',
      RUNNER_BACKEND: 'actions-vm' as const,
    };
    const input = {
      runId: 'c'.repeat(64),
      commit: 'd'.repeat(40),
      contractHash: 'e'.repeat(64),
      policy: {
        version: 'node-http-v1',
        image: env.RUNNER_IMAGE_URI,
        entrypoint: 'server.mjs',
        commands: [],
        cases: [
          {
            id: 'ready',
            path: '/ready',
            method: 'GET',
            expectedStatus: 200,
            expectedBody: {},
          },
        ],
      },
      timeoutSeconds: 60,
      memoryMiB: 256,
      files: [],
    };
    const body = canonical(input),
      hash = await digest(body),
      id = crypto.randomUUID();
    await db
      .prepare(
        'INSERT INTO actions_runner_jobs(id,run_id,request_hash,request,expires_at,synthetic) VALUES(?,?,?,?,?,1)',
      )
      .bind(id, input.runId, hash, body, Date.now() + 60000)
      .run();
    const req = (action: string, result?: unknown) =>
      new Request(
        `https://judge.example.com/api/runner/actions/${id}/${action}`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer fixture-token' },
          body: result ? JSON.stringify(result) : undefined,
        },
      );
    const owner = async () => ({ runId: '456', runAttempt: '1' });
    const other = async () => ({ runId: '999', runAttempt: '1' });
    expect((await actionsBroker(req('claim'), runtime, owner)).status).toBe(
      200,
    );
    expect((await actionsBroker(req('claim'), runtime, other)).status).toBe(
      409,
    );
    const result = {
      requestHash: hash,
      commit: input.commit,
      contractHash: input.contractHash,
      image: input.policy.image,
      version: RUNNER_VERSION,
      runtime: 'v24.14.0',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      checks: [
        {
          id: 'ready',
          kind: 'acceptance',
          status: 'FAIL',
          exitCode: null,
          durationMs: 0,
          stdout: '',
          stderr: '',
          detail: 'Absent entrypoint',
        },
      ],
    };
    await expect(
      actionsBroker(
        req('result', { ...result, commit: 'f'.repeat(40) }),
        runtime,
        owner,
      ),
    ).rejects.toThrow('RUNNER_INPUT_MISMATCH');
    expect(
      (await actionsBroker(req('result', result), runtime, other)).status,
    ).toBe(409);
    expect(
      (await actionsBroker(req('result', result), runtime, owner)).status,
    ).toBe(204);
    expect(
      (await actionsBroker(req('result', result), runtime, owner)).status,
    ).toBe(409);
    await expect(
      db
        .prepare('UPDATE actions_runner_jobs SET request=? WHERE id=?')
        .bind('{}', id)
        .run(),
    ).rejects.toThrow();
    const expired = crypto.randomUUID();
    await db
      .prepare(
        'INSERT INTO actions_runner_jobs(id,run_id,request_hash,request,expires_at,synthetic) VALUES(?,?,?,?,?,1)',
      )
      .bind(expired, input.runId, hash, body, Date.now() - 1)
      .run();
    expect(
      (
        await actionsBroker(
          new Request(
            `https://judge.example.com/api/runner/actions/${expired}/claim`,
            {
              method: 'POST',
              headers: { authorization: 'Bearer fixture-token' },
            },
          ),
          runtime,
          owner,
        )
      ).status,
    ).toBe(410);
    const actual = crypto.randomUUID();
    await db
      .prepare(
        'INSERT INTO actions_runner_jobs(id,run_id,request_hash,request,expires_at,synthetic) VALUES(?,?,?,?,?,0)',
      )
      .bind(actual, input.runId, hash, body, Date.now() + 60000)
      .run();
    expect(
      (
        await actionsBroker(
          new Request(
            `https://judge.example.com/api/runner/actions/${actual}/claim`,
            {
              method: 'POST',
              headers: { authorization: 'Bearer fixture-token' },
            },
          ),
          runtime,
          owner,
        )
      ).status,
    ).toBe(409);
  } finally {
    await mf.dispose();
  }
});
