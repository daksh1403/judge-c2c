import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { webhook } from '../src/intake';
import { api } from '../src/api';
import { canonical, digest } from '../src/domain';
import { demoContract } from '../src/demo';
import type { Env } from '../src/env';
import { reconcile } from '../src/store';

let mf: Miniflare, env: Env;
const jobs = new Map<string, unknown>();
const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil(p: Promise<unknown>) {
    pending.push(p);
  },
  passThroughOnException() {},
} as ExecutionContext;
const secret = 's'.repeat(40),
  admin = 'a'.repeat(40);
async function signed(
  head = 'b'.repeat(40),
  delivery = crypto.randomUUID(),
  updated = '2026-10-01T12:00:00Z',
  overrides: Record<string, unknown> = {},
) {
  const payload = {
    action: 'opened',
    installation: { id: 1 },
    repository: { id: 1, full_name: 'hackathon/CampaignOS' },
    pull_request: {
      number: 24,
      head: { sha: head },
      base: { repo: { id: 1 } },
      updated_at: updated,
      state: 'open',
    },
    ...overrides,
  };
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig =
    'sha256=' +
    Buffer.from(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
    ).toString('hex');
  return new Request('https://test/webhooks/github', {
    method: 'POST',
    body,
    headers: {
      'x-hub-signature-256': sig,
      'x-github-delivery': delivery,
      'x-github-event': 'pull_request',
    },
  });
}
async function register() {
  const contract = await api(
    new Request('https://test/api/contracts', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + admin },
      body: canonical(demoContract),
    }),
    env,
  );
  expect(contract.status).toBe(201);
  const assignment = await api(
    new Request('https://test/api/assignments', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + admin },
      body: JSON.stringify({
        repositoryId: 1,
        prNumber: 24,
        teamId: 'northstar',
        teamName: 'Northstar',
        issueNumbers: [12],
      }),
    }),
    env,
  );
  expect(assignment.status).toBe(201);
}
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
    compatibilityDate: '2026-08-01',
  });
  const DB = await mf.getD1Database('DB');
  // D1 exec does not parse multiline statements. Migration contains no embedded semicolons.
  const sql = readFileSync(
    new NodeURL('../migrations/0001_foundation.sql', import.meta.url),
    'utf8',
  );
  const tables = sql
    .slice(0, sql.indexOf('CREATE TRIGGER'))
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of tables) await DB.prepare(statement).run();
  await DB.prepare(
    "CREATE TRIGGER immutable_contract BEFORE UPDATE ON contracts BEGIN SELECT RAISE(ABORT,'Contracts are immutable'); END",
  ).run();
  await DB.prepare(
    "CREATE TRIGGER immutable_evaluation_inputs BEFORE UPDATE OF repository_id,pr_number,head_sha,baseline_sha,contract_hash,contract_snapshot,assignment_snapshot ON evaluations BEGIN SELECT RAISE(ABORT,'Evaluation inputs are immutable'); END",
  ).run();
  await DB.prepare(
    'ALTER TABLE assignments ADD COLUMN contract_hash TEXT REFERENCES contracts(hash)',
  ).run();
  env = {
    DB: DB as unknown as D1Database,
    ENVIRONMENT: 'local',
    ADMIN_TOKEN: admin,
    GITHUB_WEBHOOK_SECRET: secret,
    EVALUATOR: {
      async create(input: { id: string }) {
        if (jobs.has(input.id)) throw new Error('exists');
        jobs.set(input.id, input);
        return {};
      },
      async get(id: string) {
        if (!jobs.has(id)) throw new Error('missing');
        return {
          async status() {
            return { status: 'queued' };
          },
        };
      },
    } as unknown as Env['EVALUATOR'],
    ASSETS: {} as Fetcher,
  };
  await register();
}, 30000);
afterAll(async () => {
  await Promise.allSettled(pending);
  await mf?.dispose();
});
describe('signed GitHub delivery to real D1', () => {
  it('fails closed for forged events, unknown installation and unmapped PRs', async () => {
    const request = await signed();
    request.headers.set('x-hub-signature-256', 'sha256=' + '0'.repeat(64));
    expect((await webhook(request, env, ctx)).status).toBe(401);
    expect(
      (
        await webhook(
          await signed(undefined, undefined, undefined, {
            installation: { id: 2 },
          }),
          env,
          ctx,
        )
      ).status,
    ).toBe(403);
    const bad = await signed(undefined, undefined, undefined, {
      pull_request: {
        number: 25,
        head: { sha: 'b'.repeat(40) },
        base: { repo: { id: 1 } },
        updated_at: '2026-10-01T12:00:00Z',
        state: 'open',
      },
    });
    expect((await webhook(bad, env, ctx)).status).toBe(422);
    expect(
      (
        await env.DB.prepare('SELECT count(*) AS n FROM evaluations').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
  });
  it('deduplicates delivery replay and different deliveries for the same input', async () => {
    const delivery = crypto.randomUUID();
    const first = await webhook(await signed(undefined, delivery), env, ctx);
    expect(first.status).toBe(202);
    expect(
      (await webhook(await signed(undefined, delivery), env, ctx)).status,
    ).toBe(200);
    expect((await webhook(await signed(), env, ctx)).status).toBe(202);
    await Promise.all(pending);
    expect(
      (
        await env.DB.prepare('SELECT count(*) AS n FROM evaluations').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
    expect(jobs.size).toBe(1);
    expect(
      (await webhook(await signed('c'.repeat(40), delivery), env, ctx)).status,
    ).toBe(409);
  });
  it('retains old input snapshots and supersedes obsolete queued work', async () => {
    await webhook(
      await signed('c'.repeat(40), undefined, '2026-10-01T12:01:00Z'),
      env,
      ctx,
    );
    const rows = await env.DB.prepare(
      'SELECT * FROM evaluations ORDER BY head_sha',
    ).all<{
      state: string;
      head_sha: string;
      contract_snapshot: string;
    }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0]?.state).toBe('SUPERSEDED');
    expect(rows.results[1]?.state).toBe('QUEUED');
    await expect(
      env.DB.prepare('UPDATE evaluations SET head_sha=?')
        .bind('d'.repeat(40))
        .run(),
    ).rejects.toThrow('immutable');
    const hash = await digest(canonical(demoContract));
    await expect(
      env.DB.prepare('UPDATE contracts SET document=? WHERE hash=?')
        .bind('{}', hash)
        .run(),
    ).rejects.toThrow('immutable');
  });
  it('does not let delayed old events replace the latest head', async () => {
    await webhook(
      await signed('d'.repeat(40), undefined, '2026-10-01T11:00:00Z'),
      env,
      ctx,
    );
    expect(
      (
        await env.DB.prepare('SELECT head_sha FROM submissions').first<{
          head_sha: string;
        }>()
      )?.head_sha,
    ).toBe('c'.repeat(40));
    expect(
      (
        await env.DB.prepare('SELECT state FROM evaluations WHERE head_sha=?')
          .bind('d'.repeat(40))
          .first<{ state: string }>()
      )?.state,
    ).toBe('SUPERSEDED');
  });
  it('reconciles durable outbox work after dispatch failure', async () => {
    const real = env.EVALUATOR;
    env.EVALUATOR = {
      create: async () => {
        throw new Error('unavailable');
      },
      get: async () => {
        throw new Error('unavailable');
      },
    } as unknown as Env['EVALUATOR'];
    await webhook(
      await signed('e'.repeat(40), undefined, '2026-10-01T12:02:00Z'),
      env,
      ctx,
    );
    await Promise.allSettled(pending);
    expect(
      (await env.DB.prepare(
        'SELECT count(*) AS n FROM outbox WHERE dispatched_at IS NULL',
      ).first<{
        n: number;
      }>())!.n,
    ).toBeGreaterThan(0);
    env.EVALUATOR = real;
    await reconcile(env);
    expect(
      (await env.DB.prepare(
        "SELECT count(*) AS n FROM outbox o JOIN evaluations e ON e.id=o.run_id WHERE dispatched_at IS NULL AND e.state='QUEUED'",
      ).first<{ n: number }>())!.n,
    ).toBe(0);
  });
  it('exposes evidence only with admin authorization and disables review writes', async () => {
    expect(
      (await api(new Request('https://test/api/overview'), env)).status,
    ).toBe(401);
    const response = await api(
      new Request('https://test/api/overview', {
        headers: { authorization: 'Bearer ' + admin },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { runs: unknown[] }).runs.length,
    ).toBeGreaterThan(0);
    expect(
      (
        await api(
          new Request('https://test/api/contracts', {
            method: 'POST',
            body: '{}',
          }),
          {
            ...env,
            DEMO_MODE: 'true',
          },
        )
      ).status,
    ).toBe(403);
  });
  it('creates a fresh auditable run when a closed PR reopens at the same commit', async () => {
    const head = 'e'.repeat(40);
    const request = await signed(head, undefined, '2026-10-01T12:03:00Z', {
      action: 'closed',
      pull_request: {
        number: 24,
        head: { sha: head },
        base: { repo: { id: 1 } },
        updated_at: '2026-10-01T12:03:00Z',
        state: 'closed',
      },
    });
    expect((await webhook(request, env, ctx)).status).toBe(200);
    expect(
      (
        await env.DB.prepare('SELECT closed FROM submissions').first<{
          closed: number;
        }>()
      )?.closed,
    ).toBe(1);
    const reopened = await webhook(
      await signed(head, undefined, '2026-10-01T12:04:00Z', {
        action: 'reopened',
      }),
      env,
      ctx,
    );
    const result = (await reopened.json()) as { runId: string };
    expect(reopened.status).toBe(202);
    expect(
      (
        await env.DB.prepare('SELECT state FROM evaluations WHERE id=?')
          .bind(result.runId)
          .first<{ state: string }>()
      )?.state,
    ).toBe('QUEUED');
    const repeated = await webhook(
      await signed(head, undefined, '2026-10-01T12:04:00Z', {
        action: 'reopened',
      }),
      env,
      ctx,
    );
    expect(((await repeated.json()) as { runId: string }).runId).toBe(
      result.runId,
    );
  });
  it('pins each PR to its contract when another challenge becomes active', async () => {
    await register();
    const original = await digest(canonical(demoContract));
    const second = {
      ...demoContract,
      issueNumbers: [13],
      baseline: 'c'.repeat(40),
    };
    const registered = await api(
      new Request('https://test/api/contracts', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + admin },
        body: canonical(second),
      }),
      env,
    );
    expect(registered.status).toBe(201);
    const hash = ((await registered.json()) as { hash: string }).hash;
    expect(
      (
        await api(
          new Request('https://test/api/assignments', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + admin },
            body: canonical({
              repositoryId: 1,
              prNumber: 25,
              teamId: 'second',
              teamName: 'Second',
              issueNumbers: [13],
              contractHash: hash,
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    const result = await webhook(
      await signed('d'.repeat(40), undefined, '2026-10-01T12:05:00Z'),
      env,
      ctx,
    );
    expect(result.status).toBe(202);
    const runId = ((await result.json()) as { runId: string }).runId;
    const run = await env.DB.prepare(
      'SELECT contract_hash,baseline_sha FROM evaluations WHERE id=?',
    )
      .bind(runId)
      .first<{ contract_hash: string; baseline_sha: string }>();
    expect(run?.contract_hash).toBe(original);
    expect(run?.baseline_sha).toBe(demoContract.baseline);
  });
});
