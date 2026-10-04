import { expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { migrate } from './database';
import {
  organization,
  organizationEnv,
  seal,
  unseal,
} from '../src/organization';
import { eventSettings } from '../src/competition-store';
import type { Env } from '../src/env';

it('isolates two organization resources, sessions, submissions and encrypted App credentials while exposing the single-event boundary', async () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default{}',
    d1Databases: ['ORG_A', 'ORG_B'],
    compatibilityDate: '2026-08-01',
  });
  try {
    const envs: Env[] = [];
    const ctx = {
      waitUntil() {},
      passThroughOnException() {},
    } as unknown as ExecutionContext;
    for (const [i, binding] of ['ORG_A', 'ORG_B'].entries()) {
      const db = (await runtime.getD1Database(
        binding,
      )) as unknown as D1Database;
      await migrate(db);
      const name = i === 0 ? 'Organization-A' : 'Organization-B';
      const env = {
        ORG_DB: db,
        ORG_NAME: name,
        ORG_PUBLIC_ORIGIN: 'https://isolation.test',
        ORG_VAULT_KEY: '12'.repeat(32),
        ORG_ADMIN_TOKEN: `fixture-org-${i}-` + 'x'.repeat(40),
        ORG_EVALUATOR: { create: async () => ({}) },
      } as unknown as Env;
      envs.push(env);
      await db
        .prepare(
          'INSERT INTO github_connection(id,app_id,slug,encrypted,installation_id) VALUES(1,?,?,?,?)',
        )
        .bind(
          100 + i,
          `app-${i}`,
          await seal(env, {
            id: 100 + i,
            slug: `app-${i}`,
            key: `private-fixture-${i}`,
            webhookSecret: `webhook-fixture-${i}`,
          }),
          200 + i,
        )
        .run();
      await db
        .prepare(
          'INSERT INTO repositories(id,full_name,installation_id,active_contract_hash) VALUES(1,?,?,?)',
        )
        .bind(`${name}/repo`, 200 + i, 'a'.repeat(64))
        .run();
      await db
        .prepare(
          'INSERT INTO github_repositories(id,full_name,private,default_branch) VALUES(1,?,1,?)',
        )
        .bind(`${name}/repo`, 'main')
        .run();
      await db
        .prepare('INSERT INTO teams(id,name) VALUES(?,?)')
        .bind('same-team-id', `${name} team`)
        .run();
      await db
        .prepare(
          "INSERT INTO submissions(repository_id,pr_number,head_sha,github_updated_at,team_id,status) VALUES(1,1,?,?,?,'VALID')",
        )
        .bind(String(i + 1).repeat(40), '2026-10-04T00:00:00Z', 'same-team-id')
        .run();
      await db
        .prepare(
          "INSERT INTO hackathons(id,name,status,policy,taxonomy) VALUES('archived-event',?,'ARCHIVED','{}','[]')",
        )
        .bind(`${name} prior event`)
        .run();
      await db
        .prepare("UPDATE hackathons SET name=? WHERE id='initial'")
        .bind(`${name} current event`)
        .run();
    }
    const makeRequest = (
      path: string,
      session = '',
      method = 'GET',
      body?: unknown,
    ) =>
      new Request('https://isolation.test' + path, {
        method,
        headers: {
          origin: 'https://isolation.test',
          'content-type': 'application/json',
          ...(session ? { cookie: session } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const sessions: string[] = [];
    for (const env of envs) {
      const login = await organization(
        makeRequest('/api/organization/login', '', 'POST', {
          token: env.ORG_ADMIN_TOKEN,
        }),
        env,
        ctx,
      );
      expect(login.status).toBe(200);
      sessions.push(login.headers.get('set-cookie')!.split(';')[0]!);
    }
    expect(
      (
        await organization(
          makeRequest('/api/organization/manage/teams', sessions[0]),
          envs[1]!,
          ctx,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await organization(
          makeRequest('/api/organization/manage/teams', sessions[1]),
          envs[0]!,
          ctx,
        )
      ).status,
    ).toBe(401);
    for (const [i, env] of envs.entries()) {
      const own = i === 0 ? 'Organization-A' : 'Organization-B',
        other = i === 0 ? 'Organization-B' : 'Organization-A';
      for (const path of [
        '/api/organization/manage/teams',
        '/api/organization/manage/submissions',
        '/api/organization/status',
      ]) {
        const response = await organization(
          makeRequest(path, sessions[i]),
          env,
          ctx,
        );
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain(own);
        expect(text).not.toContain(other);
        expect(text).not.toContain('private-fixture');
        expect(text).not.toContain('webhook-fixture');
      }
      const effective = await organizationEnv(env);
      expect(effective.DB).toBe(env.ORG_DB);
      expect(effective.GITHUB_APP_ID).toBe(String(100 + i));
      expect(effective.GITHUB_APP_PRIVATE_KEY).toBe(`private-fixture-${i}`);
      expect((await eventSettings(env)).name).toBe(`${own} current event`);
      expect(
        await env
          .ORG_DB!.prepare(
            "SELECT name FROM hackathons WHERE id='archived-event'",
          )
          .first(),
      ).toEqual({ name: `${own} prior event` });
    }
    const encrypted = (await envs[0]!
      .ORG_DB!.prepare('SELECT encrypted FROM github_connection WHERE id=1')
      .first<{ encrypted: string }>())!.encrypted;
    // Same vault key still cannot cross organizations: authenticated additional data binds ORG_NAME.
    await expect(unseal(envs[1]!, encrypted)).rejects.toThrow();
    await envs[1]!
      .ORG_DB!.prepare('UPDATE github_connection SET encrypted=? WHERE id=1')
      .bind(encrypted)
      .run();
    await expect(organizationEnv(envs[1]!)).rejects.toThrow();
    expect((await organizationEnv(envs[0]!)).GITHUB_APP_ID).toBe('100');
  } finally {
    await runtime.dispose();
  }
}, 30000);
