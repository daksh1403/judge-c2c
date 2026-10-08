import { afterEach, expect, it, vi } from 'vitest';
import { migrate } from './database';
import { sqliteD1 } from './fixtures/sqlite-d1';
import { canonical, digest, type Contract } from '../src/domain';
import { demoContract } from '../src/demo';
import { GitHub } from '../src/github';
import { runObjective, type RunnerRequest } from '../src/runner';
import { RUNNER_VERSION } from '../src/runner-policy';
import { actionsBroker } from '../src/actions-runner';
import type { Env } from '../src/env';

afterEach(() => vi.restoreAllMocks());
it('continues baseline/head polling without repeated snapshots, dispatches or evidence rows', async () => {
  const fixture = sqliteD1();
  try {
    const db = fixture.db;
    await migrate(db);
    const image = 'qemu-vm@sha256:' + 'd'.repeat(64),
      runId = 'c'.repeat(64),
      head = 'b'.repeat(40);
    const contract: Contract = {
      ...demoContract,
      execution: {
        ...demoContract.execution,
        runner: {
          version: 'node-http-v1',
          image,
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
          cache: 'NONE',
        },
      },
      requirements: [
        {
          id: 'ready',
          title: 'Ready',
          mandatory: true,
          criteria: [
            {
              id: 'ready',
              description: 'Ready endpoint responds',
              kind: 'functional',
              verification: { type: 'runner', checkId: 'ready' },
            },
          ],
        },
      ],
    };
    const hash = await digest(canonical(contract));
    await db.batch([
      db
        .prepare(
          'INSERT INTO repositories(id,full_name,installation_id,active_contract_hash) VALUES(?,?,1,?)',
        )
        .bind(contract.repository.id, contract.repository.fullName, hash),
      db
        .prepare(
          'INSERT INTO contracts(hash,repository_id,document) VALUES(?,?,?)',
        )
        .bind(hash, contract.repository.id, canonical(contract)),
      db
        .prepare(
          "INSERT INTO evaluations(id,repository_id,pr_number,head_sha,baseline_sha,contract_hash,contract_snapshot,assignment_snapshot,state) VALUES(?,?,1,?,?,?,?,'{}','CHECKING')",
        )
        .bind(
          runId,
          contract.repository.id,
          head,
          contract.baseline,
          hash,
          canonical(contract),
        ),
      db
        .prepare(
          "INSERT INTO submissions(repository_id,pr_number,head_sha,latest_run_id,github_updated_at) VALUES(?,1,?,?,'2026-10-08T00:00:00Z')",
        )
        .bind(contract.repository.id, head, runId),
    ]);
    const file = vi.fn(async () => 'export default 1;');
    vi.spyOn(GitHub, 'installation').mockResolvedValue({
      api: async () => ({
        truncated: false,
        tree: [{ path: 'server.mjs', type: 'blob', mode: '100644', size: 17 }],
      }),
      file,
    } as unknown as GitHub);
    vi.spyOn(GitHub, 'application').mockResolvedValue({
      api: async () => ({ token: 'synthetic' }),
    } as unknown as GitHub);
    let dispatches = 0;
    vi.spyOn(GitHub.prototype, 'api').mockImplementation(async (path) => {
      if (path.includes('/dispatches')) {
        dispatches++;
        return undefined;
      }
      return path.includes('/branches/')
        ? { commit: { sha: 'a'.repeat(40) } }
        : { id: 123, private: false };
    });
    const env = {
      DB: db,
      ENVIRONMENT: 'local',
      RUNNER_ENABLED: 'true',
      RUNNER_BACKEND: 'actions-vm',
      RUNNER_IMAGE_URI: image,
      RUNNER_ACTIONS_REPOSITORY: 'owner/runner',
      RUNNER_ACTIONS_REPOSITORY_ID: '123',
      RUNNER_ACTIONS_REF: 'main',
      RUNNER_ACTIONS_SHA: 'a'.repeat(40),
      RUNNER_ACTIONS_ORIGIN: 'https://judge.example.com',
      RUNNER_APP_ID: '1',
      RUNNER_APP_PRIVATE_KEY: 'synthetic',
      RUNNER_INSTALLATION_ID: '1',
    } as Env;
    const evaluate = () =>
      runObjective(
        env,
        { id: runId, head_sha: head, contract_hash: hash },
        contract,
        [],
        { deferActions: true },
      );
    const complete = async (commit: string, status: 'FAIL' | 'PASS') => {
      const job = await db
        .prepare(
          "SELECT id,request,request_hash FROM actions_runner_jobs WHERE json_extract(request,'$.commit')=?",
        )
        .bind(commit)
        .first<{ id: string; request: string; request_hash: string }>();
      const input = JSON.parse(job!.request) as RunnerRequest;
      const owner = async () => ({
        runId: String(dispatches),
        runAttempt: '1',
      });
      const req = (action: string, body?: unknown) =>
        new Request(
          `https://judge.example.com/api/runner/actions/${job!.id}/${action}`,
          {
            method: 'POST',
            headers: { authorization: 'Bearer synthetic' },
            body: body ? JSON.stringify(body) : undefined,
          },
        );
      expect((await actionsBroker(req('claim'), env, owner)).status).toBe(200);
      expect(
        (
          await actionsBroker(
            req('result', {
              requestHash: job!.request_hash,
              commit,
              contractHash: hash,
              version: RUNNER_VERSION,
              image,
              runtime: 'v24.14.0',
              startedAt: '2026-10-08T00:00:00Z',
              finishedAt: '2026-10-08T00:00:01Z',
              checks: [
                {
                  id: input.policy.cases[0]!.id,
                  kind: 'acceptance',
                  status,
                  exitCode: null,
                  durationMs: 1,
                  stdout: '',
                  stderr: '',
                  detail: 'Synthetic protocol fixture',
                },
              ],
            }),
            env,
            owner,
          )
        ).status,
      ).toBe(204);
    };
    for (let poll = 0; poll < 10; poll++)
      await expect(evaluate()).rejects.toThrow('RUNNER_PENDING');
    expect(file).toHaveBeenCalledTimes(1);
    expect(dispatches).toBe(1);
    await complete(contract.baseline, 'FAIL');
    for (let poll = 0; poll < 10; poll++)
      await expect(evaluate()).rejects.toThrow('RUNNER_PENDING');
    expect(file).toHaveBeenCalledTimes(2);
    expect(dispatches).toBe(2);
    expect(
      await db.prepare('SELECT COUNT(*) AS n FROM execution_results').first(),
    ).toEqual({ n: 1 });
    await complete(head, 'PASS');
    expect(await evaluate()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterionId: 'ready',
          status: 'PASS',
          baselineStatus: 'FAIL',
        }),
      ]),
    );
    await evaluate();
    expect(
      await db.prepare('SELECT COUNT(*) AS n FROM execution_results').first(),
    ).toEqual({ n: 2 });
    expect(
      await db.prepare('SELECT COUNT(*) AS n FROM actions_runner_jobs').first(),
    ).toEqual({ n: 2 });
    expect(file).toHaveBeenCalledTimes(2);
    expect(dispatches).toBe(2);
    expect(
      await db.prepare('SELECT COUNT(*) AS n FROM reviewer_slots').first(),
    ).toEqual({ n: 0 });
  } finally {
    fixture.close();
  }
});
