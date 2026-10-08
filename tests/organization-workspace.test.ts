import { describe, it, expect, vi } from 'vitest';
import {
  mkdtemp,
  readFile,
  writeFile,
  stat,
  rm,
  copyFile,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  planWorkspace,
  provisionWorkspace,
  verifyWorkspace,
  retireWorkspace,
  createAdapters,
  // @ts-expect-error Node ESM operator script intentionally has no TS declarations.
} from '../scripts/organization-workspace.mjs';
const options = {
  organization: 'Event-Alpha',
  workspace: 'event-alpha',
  accountId: 'a'.repeat(32),
  origin: 'https://alpha.example.org',
  runnerEndpoint: 'https://runner.example.org',
  runnerImage:
    'registry.cloudflare.com/account/runner@sha256:' + 'a'.repeat(64),
  provider: 'cloudflare',
  model: '@cf/meta/model',
};
function adapters() {
  let n = 0;
  const inventory: Record<string, { name: string; id: string }[]> = {
    database: [],
    kv: [],
    bucket: [],
    worker: [],
    workflow: [],
  };
  return {
    githubIdentity: vi.fn(async () => ({ login: 'owner' })),
    githubMembership: vi.fn(async () => ({ state: 'active', role: 'admin' })),
    inventory: vi.fn(async () => structuredClone(inventory)),
    knownResources: vi.fn(async () => []),
    createResource: vi.fn(async (kind: string, name: string) => {
      const id =
        kind === 'database'
          ? `${++n}`.repeat(8) + '-1111-1111-1111-' + `${n}`.repeat(12)
          : kind === 'kv'
            ? 'c'.repeat(32)
            : name;
      inventory[kind]!.push({ name, id });
      return { name, id };
    }),
    migrate: vi.fn(async () => {}),
    secret: vi.fn(async () => {
      if (!inventory.worker!.length)
        inventory.worker!.push({
          name: 'judge-c2c-event-alpha',
          id: 'judge-c2c-event-alpha',
        });
    }),
    deploy: vi.fn(async () => {}),
    approvedRuntime: vi.fn(async () => {}),
    workspaceStatus: vi.fn(async () => ({
      authenticated: true,
      role: 'organizer',
      organization: options.organization,
      app: { id: 42, slug: 'event-app', installationId: 84 },
      runner: { enabled: true },
      ai: { enabled: true },
    })),
    app: vi.fn(async () => ({
      id: 42,
      slug: 'event-app',
      owner: { login: options.organization, type: 'Organization' },
    })),
    installation: vi.fn(async () => ({
      id: 84,
      app_id: 42,
      account: { login: options.organization, type: 'Organization' },
      suspended_at: null,
      repository_selection: 'selected',
      permissions: {
        contents: 'read',
        pull_requests: 'read',
        issues: 'write',
        checks: 'write',
        metadata: 'read',
      },
    })),
    repositories: vi.fn(async () => [
      {
        full_name: `${options.organization}/project`,
        private: true,
        accessible: 1,
      },
    ]),
    runnerDiagnostic: vi.fn(async () => ({
      synthetic: true,
      status: 'COMPLETED',
      results: [
        { label: 'baseline', result: { checks: [{ status: 'FAIL' }] } },
        { label: 'submission', result: { checks: [{ status: 'PASS' }] } },
      ],
    })),
    providerDiagnostic: vi.fn(async () => ({
      synthetic: true,
      status: 'UNAVAILABLE',
    })),
  };
}
async function temporary(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'org-workspace-'));
  try {
    await copyFile('wrangler.jsonc', join(root, 'wrangler.jsonc'));
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
describe('organization workspace setup', () => {
  const actions = {
    ...options,
    runnerMode: 'ACTIONS_VM',
    runnerEndpoint: undefined,
    runnerImage: 'qemu-vm@sha256:' + 'b'.repeat(64),
    runnerRepository: 'owner/judge',
    runnerRepositoryId: '123',
    runnerRef: 'main',
    runnerSha: 'c'.repeat(40),
    runnerInstallationId: '456',
    workersSubdomain: 'owner-account',
    origin: 'https://judge-c2c-event-alpha.owner-account.workers.dev',
  };
  it('plans Actions VM workspaces without a tunnel and pins the runner identity', async () => {
    const a = adapters();
    a.knownResources.mockResolvedValue([
      { name: 'existing-protected-worker' },
    ] as never);
    const plan = await planWorkspace(actions, a);
    expect(plan.runner).toMatchObject({
      backend: 'actions-vm',
      repository: actions.runnerRepository,
      sha: actions.runnerSha,
      image: actions.runnerImage,
    });
    expect(plan.runner).not.toHaveProperty('endpoint');
  });
  it('provisions an Actions workspace with isolated storage and no tunnel credential', async () =>
    temporary(async (root) => {
      const a = adapters();
      await provisionWorkspace(actions, a, { root });
      const directory = join(root, '.wrangler/workspaces/event-alpha');
      const config = JSON.parse(
        await readFile(join(directory, 'config.json'), 'utf8'),
      );
      const journal = JSON.parse(
        await readFile(join(directory, 'journal.json'), 'utf8'),
      );
      expect(config.vars).toMatchObject({
        RUNNER_BACKEND: 'actions-vm',
        RUNNER_ACTIONS_REPOSITORY: actions.runnerRepository,
        RUNNER_ACTIONS_SHA: actions.runnerSha,
        RUNNER_INSTALLATION_ID: actions.runnerInstallationId,
      });
      expect(config.vars).not.toHaveProperty('RUNNER_ENDPOINT');
      expect(journal.secrets).not.toHaveProperty('RUNNER_TUNNEL_KEY');
      expect(a.deploy).not.toHaveBeenCalled();
    }));
  it('issues an Actions verification receipt with one exact validity window', async () =>
    temporary(async (root) => {
      const a = adapters();
      await provisionWorkspace(actions, a, { root });
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
      try {
        const receipt = await verifyWorkspace(
          actions,
          {
            appId: 42,
            appSlug: 'event-app',
            installationId: 84,
            repositories: [`${options.organization}/project`],
          },
          a,
          { root },
        );
        expect(receipt.runner).toBe('OIDC_SYNTHETIC_COMPLETED');
        expect(Date.parse(receipt.expiresAt) - Date.parse(receipt.at)).toBe(
          900000,
        );
      } finally {
        clock.mockRestore();
      }
    }));
  it('plans and provisions KV-only Actions storage without creating an R2 bucket', async () =>
    temporary(async (root) => {
      const a = adapters();
      const target = { ...actions, artifactStorage: 'kv' };
      const plan = await planWorkspace(target, a);
      expect(
        plan.resources.some((r: { kind: string }) => r.kind === 'bucket'),
      ).toBe(false);
      await provisionWorkspace(target, a, { root });
      expect(a.createResource.mock.calls.map(([kind]) => kind)).toEqual([
        'database',
        'database',
        'kv',
      ]);
      const config = JSON.parse(
        await readFile(
          join(root, '.wrangler/workspaces/event-alpha/config.json'),
          'utf8',
        ),
      );
      expect(config).not.toHaveProperty('r2_buckets');
      expect(config.kv_namespaces[0].binding).toBe('ARTIFACT_KV');
    }));
  it('omits R2 inventory requests only when that storage is explicitly excluded', async () => {
    const request = vi.fn(async (url: string) => {
      if (url.includes('r2/buckets')) throw new Error('R2_NOT_ENABLED');
      return Response.json({ success: true, result: [] });
    });
    const a = createAdapters({
      env: {
        CLOUDFLARE_ACCOUNT_ID: options.accountId,
        CLOUDFLARE_API_TOKEN: 'fixture-token',
      },
      request,
    });
    const inventory = await a.inventory(options.accountId, {
      includeR2: false,
    });
    expect(inventory.bucket).toEqual([]);
    expect(request.mock.calls.some(([url]) => url.includes('r2/buckets'))).toBe(
      false,
    );
    await expect(a.inventory(options.accountId)).rejects.toThrow(
      'R2_NOT_ENABLED',
    );
  });
  it('allows the bounded Actions runner canary to finish beyond ordinary API timeouts', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const request = vi.fn(async (url: string) =>
        url.endsWith('/login')
          ? Response.json(
              { authenticated: true },
              {
                headers: { 'set-cookie': 'judge_organizer=fixture; HttpOnly' },
              },
            )
          : Response.json({ synthetic: true, status: 'COMPLETED' }),
      );
      const a = createAdapters({ request });
      await a.runnerDiagnostic(
        'https://event.example.org',
        'private-fixture-token',
      );
      expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([30000, 30 * 60000]);
    } finally {
      timeout.mockRestore();
    }
  });
  it('refuses KV-only managed profiles and unknown storage modes before remote actions', async () => {
    for (const target of [
      { ...options, artifactStorage: 'kv' },
      { ...actions, artifactStorage: 'unknown' },
    ]) {
      const a = adapters();
      await expect(planWorkspace(target, a)).rejects.toThrow();
      expect(a.githubIdentity).not.toHaveBeenCalled();
    }
  });
  it.each([
    { runnerSha: 'latest' },
    { runnerRepositoryId: '0' },
    { runnerRef: '../main' },
    { runnerInstallationId: undefined },
    { runnerEndpoint: 'https://runner.example.org' },
    { origin: 'https://judge-c2c-production.owner-account.workers.dev' },
  ])(
    'rejects an invalid Actions workspace before remote writes: %j',
    async (override) => {
      const a = adapters();
      await expect(
        planWorkspace({ ...actions, ...override }, a),
      ).rejects.toThrow();
      expect(a.createResource).not.toHaveBeenCalled();
      expect(a.githubIdentity).not.toHaveBeenCalled();
    },
  );
  it('plans two arbitrary organizations with distinct exact resources and no mutations', async () => {
    const a = adapters();
    const first = await planWorkspace(options, a);
    const second = await planWorkspace(
      {
        ...options,
        organization: 'Another-Org',
        workspace: 'another-event',
        origin: 'https://another.example.org',
      },
      a,
    );
    expect(
      first.resources
        .map((r: { name: string }) => r.name)
        .every(
          (n: string) =>
            !second.resources.some((r: { name: string }) => r.name === n),
        ),
    ).toBe(true);
    expect(first.resources).toHaveLength(7);
    expect(a.createResource).not.toHaveBeenCalled();
    expect(a.secret).not.toHaveBeenCalled();
    expect(a.deploy).not.toHaveBeenCalled();
    expect(JSON.stringify(first)).not.toMatch(/database_id|token|secret/i);
  });
  it('allows only a pinned owner tunnel and its exact transport origin', async () => {
    const owner = {
      ...options,
      runnerMode: 'OWNER_TUNNEL',
      runnerEndpoint: 'https://owner.trycloudflare.com',
      runnerImage: 'docker-local@sha256:' + 'b'.repeat(64),
    };
    expect((await planWorkspace(owner, adapters())).runner.endpoint).toBe(
      owner.runnerEndpoint,
    );
    for (const runnerEndpoint of [
      'https://owner.trycloudflare.com.evil.org',
      'https://owner.trycloudflare.com:8443',
      'https://runner.example.org',
    ])
      await expect(
        planWorkspace({ ...owner, runnerEndpoint }, adapters()),
      ).rejects.toThrow();
  });
  it('supports only the exact workspace workers.dev identity in owner tunnel mode', async () => {
    const owner = {
      ...options,
      runnerMode: 'OWNER_TUNNEL',
      runnerEndpoint: 'https://owner.trycloudflare.com',
      runnerImage: 'docker-local@sha256:' + 'b'.repeat(64),
      workersSubdomain: 'owner-account',
      origin: 'https://judge-c2c-event-alpha.owner-account.workers.dev',
    };
    expect((await planWorkspace(owner, adapters())).origin).toBe(owner.origin);
    for (const override of [
      { workersSubdomain: undefined },
      { origin: 'https://judge-c2c-production.owner-account.workers.dev' },
      { origin: 'https://judge-c2c-event-alpha.foreign-account.workers.dev' },
      { runnerMode: 'MANAGED', runnerImage: options.runnerImage },
    ])
      await expect(
        planWorkspace({ ...owner, ...override }, adapters()),
      ).rejects.toThrow();
  });
  it('denies invalid inputs and non-admin actors before any mutation', async () => {
    for (const overrides of [
      { organization: 'bad--org' },
      { workspace: 'production' },
      { origin: 'https://review.example.org' },
      { origin: 'https://judge.owner.workers.dev' },
      { runnerImage: 'latest' },
      { accountId: 'wrong' },
    ]) {
      const a = adapters();
      await expect(
        planWorkspace({ ...options, ...overrides }, a),
      ).rejects.toThrow();
      expect(a.githubIdentity).not.toHaveBeenCalled();
      expect(a.createResource).not.toHaveBeenCalled();
    }
    const a = adapters();
    a.githubMembership.mockResolvedValue({ role: 'member', state: 'active' });
    await expect(planWorkspace(options, a)).rejects.toThrow(/admin/i);
    expect(a.inventory).not.toHaveBeenCalled();
  });
  it('rejects existing cloud resources and current production identifiers', async () => {
    const a = adapters();
    a.inventory.mockResolvedValue({
      database: [{ name: 'judge-c2c-event-alpha-evaluations', id: 'other' }],
      kv: [],
      bucket: [],
      worker: [],
      workflow: [],
    });
    await expect(planWorkspace(options, a)).rejects.toThrow(/exist|collision/i);
    const b = adapters();
    b.knownResources.mockResolvedValue([
      { name: 'foreign-production', origin: options.origin },
    ] as never);
    await expect(planWorkspace(options, b)).rejects.toThrow(/reuse|collision/i);
  });
  const oversizedOrigin = `https://${Array(5).fill('a'.repeat(60)).join('.')}`;
  it('rejects an oversized public hostname during planning before adapter calls', async () => {
    expect(new URL(oversizedOrigin).hostname).toHaveLength(304);
    const a = adapters();
    await expect(
      planWorkspace({ ...options, origin: oversizedOrigin }, a),
    ).rejects.toThrow(/hostname|origin/i);
    expect(a.githubIdentity).not.toHaveBeenCalled();
    expect(a.inventory).not.toHaveBeenCalled();
  });
  it('rejects an oversized public hostname before provisioning or private state', async () =>
    temporary(async (root) => {
      const a = adapters();
      await expect(
        provisionWorkspace({ ...options, origin: oversizedOrigin }, a, {
          root,
        }),
      ).rejects.toThrow(/hostname|origin/i);
      expect(a.createResource).not.toHaveBeenCalled();
      expect(a.migrate).not.toHaveBeenCalled();
      expect(a.secret).not.toHaveBeenCalled();
      expect(a.deploy).not.toHaveBeenCalled();
      expect(a.githubIdentity).not.toHaveBeenCalled();
      await expect(stat(join(root, '.wrangler'))).rejects.toThrow();
    }));
  it('denies a proposed runner endpoint that matches a known protected origin', async () =>
    temporary(async (root) => {
      const a = adapters();
      a.knownResources.mockResolvedValue([
        { origin: options.runnerEndpoint },
      ] as never);
      await expect(planWorkspace(options, a)).rejects.toThrow(
        /reuse|collision/i,
      );
      await expect(provisionWorkspace(options, a, { root })).rejects.toThrow(
        /reuse|collision/i,
      );
      expect(a.createResource).not.toHaveBeenCalled();
      expect(a.migrate).not.toHaveBeenCalled();
      expect(a.secret).not.toHaveBeenCalled();
      expect(a.deploy).not.toHaveBeenCalled();
      await expect(stat(join(root, '.wrangler'))).rejects.toThrow();
    }));
  it.each(['native', 'review', 'current'])(
    'denies reuse of the %s runner identity as either workspace endpoint without mutation',
    async (profile) =>
      temporary(async (root) => {
        const protectedOrigin = 'https://kept-runner.example.org';
        const protectedConfig = {
          vars: { RUNNER_ENDPOINT: `${protectedOrigin}:443/` },
        };
        await writeFile(
          join(root, 'wrangler.jsonc'),
          JSON.stringify(
            profile === 'native'
              ? protectedConfig
              : profile === 'review'
                ? { env: { review: protectedConfig } }
                : {},
          ),
        );
        if (profile === 'current') {
          await mkdir(join(root, '.wrangler'));
          await writeFile(
            join(root, '.wrangler/production.json'),
            JSON.stringify(protectedConfig),
          );
        }
        const command = vi.fn(async (_executable: string, args: string[]) =>
          args[0] === 'auth'
            ? ''
            : JSON.stringify(
                args[1] === '/user'
                  ? { login: 'owner' }
                  : { state: 'active', role: 'admin' },
              ),
        );
        const request = vi.fn(async (url: string) =>
          Response.json({
            success: true,
            result: url.includes('r2/buckets') ? { buckets: [] } : [],
          }),
        );
        const live = createAdapters({
          root,
          env: {
            CLOUDFLARE_ACCOUNT_ID: options.accountId,
            CLOUDFLARE_API_TOKEN: 'synthetic-cloud-token',
          },
          command,
          request,
        });
        const create = vi.spyOn(live, 'createResource');
        const migrate = vi.spyOn(live, 'migrate');
        const secret = vi.spyOn(live, 'secret');
        const deploy = vi.spyOn(live, 'deploy');
        for (const target of [
          { ...options, runnerEndpoint: protectedOrigin },
          { ...options, origin: protectedOrigin },
        ]) {
          await expect(planWorkspace(target, live)).rejects.toThrow(
            /reuse|collision/i,
          );
          await expect(
            provisionWorkspace(target, live, { root }),
          ).rejects.toThrow(/reuse|collision/i);
        }
        expect(create).not.toHaveBeenCalled();
        expect(migrate).not.toHaveBeenCalled();
        expect(secret).not.toHaveBeenCalled();
        expect(deploy).not.toHaveBeenCalled();
        expect(
          command.mock.calls.every(([executable]) => executable === 'gh'),
        ).toBe(true);
        await expect(
          stat(join(root, '.wrangler/workspaces')),
        ).rejects.toThrow();
      }),
  );
  it('persists fresh secrets privately, resumes completed stages, and never automatically deploys', async () =>
    temporary(async (root) => {
      const a = adapters();
      a.migrate.mockRejectedValueOnce(
        new Error('remote error with must-never-log-token'),
      );
      await expect(provisionWorkspace(options, a, { root })).rejects.toThrow(
        /migration/,
      );
      const journalPath = join(
        root,
        '.wrangler/workspaces/event-alpha/journal.json',
      );
      const journal = JSON.parse(await readFile(journalPath, 'utf8'));
      expect((await stat(journalPath)).mode & 0o777).toBe(0o600);
      expect(
        Object.values(journal.secrets).every(
          (v) => typeof v === 'string' && v.length === 64,
        ),
      ).toBe(true);
      expect(new Set(Object.values(journal.secrets)).size).toBe(
        Object.keys(journal.secrets).length,
      );
      await provisionWorkspace(options, a, { root });
      expect(a.createResource).toHaveBeenCalledTimes(4);
      expect(a.deploy).not.toHaveBeenCalled();
      expect(JSON.parse(await readFile(journalPath, 'utf8')).secrets).toEqual(
        journal.secrets,
      );
      expect(
        await readFile(
          join(root, '.wrangler/workspaces/event-alpha/config.json'),
          'utf8',
        ),
      ).not.toContain(journal.secrets.ORG_ADMIN_TOKEN);
      await expect(
        provisionWorkspace({ ...options, organization: 'Other-Org' }, a, {
          root,
        }),
      ).rejects.toThrow(/target|journal/i);
    }));
  it('fails closed on resumed resource identity changes and refuses feature deployment', async () =>
    temporary(async (root) => {
      const a = adapters();
      await provisionWorkspace(options, a, { root });
      a.inventory.mockResolvedValue({
        database: [],
        kv: [],
        bucket: [],
        worker: [],
        workflow: [],
      });
      await expect(provisionWorkspace(options, a, { root })).rejects.toThrow(
        /identity|missing/i,
      );
      const b = adapters();
      b.approvedRuntime.mockRejectedValue(
        new Error('requires clean main at origin/main'),
      );
      await expect(
        provisionWorkspace({ ...options, workspace: 'second-event' }, b, {
          root,
          deploy: true,
        }),
      ).rejects.toThrow(/clean main/);
      expect(b.createResource).not.toHaveBeenCalled();
    }));
  it('does not leak external errors or leave stale verification successes', async () =>
    temporary(async (root) => {
      const a = adapters();
      await provisionWorkspace(options, a, { root });
      a.workspaceStatus.mockRejectedValue(new Error('private-token-leak'));
      await expect(
        verifyWorkspace(
          options,
          {
            appId: 42,
            appSlug: 'event-app',
            installationId: 84,
            repositories: [`${options.organization}/project`],
          },
          a,
          { root },
        ),
      ).rejects.not.toThrow(/private-token-leak/);
    }));
  it('uses a private bootstrap config and authenticated pinned Wrangler adapter for real create arguments', async () =>
    temporary(async (root) => {
      await copyFile('package.json', join(root, 'package.json'));
      await mkdir(join(root, 'node_modules/wrangler'), { recursive: true });
      await copyFile(
        'node_modules/wrangler/package.json',
        join(root, 'node_modules/wrangler/package.json'),
      );
      const records: {
        executable: string;
        args: string[];
        input: unknown;
        config: Record<string, unknown>;
        env: Record<string, string>;
      }[] = [];
      const remote: Record<string, { name: string; id: string }[]> = {
        database: [],
        kv: [],
        bucket: [],
        worker: [],
        workflow: [],
      };
      let database = 0;
      const command = async (
        executable: string,
        args: string[],
        settings: { input?: string; env: Record<string, string> },
      ) => {
        if (executable === 'gh') {
          if (args[0] === 'auth') return '';
          if (args[1] === '/user') return JSON.stringify({ login: 'owner' });
          return JSON.stringify({ state: 'active', role: 'admin' });
        }
        const config = JSON.parse(
          await readFile(args[args.indexOf('--config') + 1]!, 'utf8'),
        );
        records.push({
          executable,
          args,
          input: settings.input,
          config,
          env: settings.env,
        });
        if (args.includes('create')) {
          const kind = args.includes('d1')
            ? 'database'
            : args.includes('kv')
              ? 'kv'
              : 'bucket';
          const name = args[args.indexOf('create') + 1]!;
          remote[kind]!.push({
            name,
            id:
              kind === 'database'
                ? `${++database}`.repeat(8) +
                  '-1111-1111-1111-' +
                  `${database}`.repeat(12)
                : kind === 'kv'
                  ? 'd'.repeat(32)
                  : name,
          });
        }
        if (args.includes('secret') && !remote.worker!.length)
          remote.worker!.push({ name: config.name, id: config.name });
        return '';
      };
      const request = async (url: string) => {
        const kind = url.includes('d1/database')
          ? 'database'
          : url.includes('kv/namespaces')
            ? 'kv'
            : url.includes('r2/buckets')
              ? 'bucket'
              : url.includes('workers/scripts')
                ? 'worker'
                : 'workflow';
        const values = remote[kind]!.map((r) =>
          kind === 'database'
            ? { name: r.name, uuid: r.id }
            : kind === 'kv'
              ? { title: r.name, id: r.id }
              : kind === 'worker'
                ? { id: r.name }
                : { name: r.name, id: r.id },
        );
        return Response.json({
          success: true,
          result: kind === 'bucket' ? { buckets: values } : values,
        });
      };
      const live = createAdapters({
        root,
        env: {
          PATH: process.env.PATH,
          CLOUDFLARE_ACCOUNT_ID: options.accountId,
          CLOUDFLARE_API_TOKEN: 'operator-cloud-token',
          ORG_ADMIN_TOKEN: 'old-rehearsal-token',
        },
        command,
        request,
      });
      await provisionWorkspace(options, live, { root });
      const first = records[0]!;
      expect(first.config).toEqual({
        name: 'judge-c2c-event-alpha',
        account_id: options.accountId,
      });
      expect(first.args).toContain('--update-config=false');
      expect(first.args[0]).toBe(
        join(root, 'node_modules/wrangler/bin/wrangler.js'),
      );
      expect(first.env.ORG_ADMIN_TOKEN).toBeUndefined();
      expect(
        records
          .filter((r) => r.args.includes('migrations'))
          .map((r) => r.args[4]),
      ).toEqual(['DB', 'ORG_DB']);
      expect(
        records
          .filter((r) => r.args.includes('secret'))
          .every(
            (r) =>
              typeof r.input === 'string' &&
              !r.args.includes(r.input as string),
          ),
      ).toBe(true);
      expect(
        (await stat(join(root, '.wrangler/workspaces/event-alpha/config.json')))
          .mode & 0o777,
      ).toBe(0o600);
    }));
  it('retains interrupted creation as ambiguous and refuses automatic adoption on retry', async () =>
    temporary(async (root) => {
      const a = adapters();
      a.createResource.mockRejectedValueOnce(new Error('remote failed'));
      await expect(provisionWorkspace(options, a, { root })).rejects.toThrow(
        /create/,
      );
      await expect(provisionWorkspace(options, a, { root })).rejects.toThrow(
        /Ambiguous/,
      );
      expect(a.createResource).toHaveBeenCalledTimes(1);
    }));
  it('does not create private state when an applying actor lacks admin access', async () =>
    temporary(async (root) => {
      const a = adapters();
      a.githubMembership.mockResolvedValue({ role: 'member', state: 'active' });
      await expect(provisionWorkspace(options, a, { root })).rejects.toThrow(
        /admin/,
      );
      await expect(stat(join(root, '.wrangler'))).rejects.toThrow();
    }));
  it('uses pinned local Wrangler and stdin for secrets with no command output leaks', async () => {
    const command = vi.fn(
      async (
        _executable: string,
        _args: string[],
        _options: Record<string, unknown>,
      ) => '',
    );
    const a = createAdapters({
      root: process.cwd(),
      env: {
        CLOUDFLARE_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: options.accountId,
      },
      command,
    });
    await a.secret('ORG_ADMIN_TOKEN', 'private-token', '/private/config.json');
    expect(command.mock.calls[0]).toMatchObject([
      'node',
      expect.any(Array),
      expect.objectContaining({ input: 'private-token' }),
    ]);
    expect(JSON.stringify(command.mock.calls[0]![1])).not.toContain(
      'private-token',
    );
  });
});
describe('replacement connection verification', () => {
  const expected = {
    appId: 42,
    installationId: 84,
    appSlug: 'event-app',
    repositories: [`${options.organization}/project`],
  };
  it('binds bounded verification to the exact target and exposes provider failure separately', async () =>
    temporary(async (root) => {
      const a = adapters();
      await provisionWorkspace(options, a, { root });
      const result = await verifyWorkspace(options, expected, a, { root });
      expect(result.connection).toBe('VERIFIED');
      expect(result.provider).toBe('UNAVAILABLE');
      expect(result.functionalEvaluation).toBe('UNVERIFIED');
      const saved = JSON.parse(
        await readFile(
          join(root, '.wrangler/workspaces/event-alpha/journal.json'),
          'utf8',
        ),
      ).verification;
      expect(saved.organization).toBe(options.organization);
      expect(saved.origin).toBe(options.origin);
      expect(saved.appId).toBe(42);
      expect(saved.repositories).toEqual(expected.repositories);
      expect(JSON.stringify(saved)).not.toContain('private-token');
    }));
  it('refuses identity, permission, selected access, authentication, or runner mismatches', async () =>
    temporary(async (root) => {
      const a = adapters();
      await provisionWorkspace(options, a, { root });
      const mutate = [
        (b: ReturnType<typeof adapters>) =>
          b.app.mockResolvedValue({
            id: 42,
            slug: 'event-app',
            owner: { login: 'Wrong-Org', type: 'Organization' },
          }),
        (b: ReturnType<typeof adapters>) =>
          b.installation.mockResolvedValue({
            id: 84,
            app_id: 42,
            account: { login: options.organization, type: 'Organization' },
            suspended_at: null,
            repository_selection: 'selected',
            permissions: { contents: 'write' },
          } as never),
        (b: ReturnType<typeof adapters>) =>
          b.repositories.mockResolvedValue([]),
        (b: ReturnType<typeof adapters>) =>
          b.workspaceStatus.mockResolvedValue({
            authenticated: false,
          } as never),
        (b: ReturnType<typeof adapters>) =>
          b.runnerDiagnostic.mockResolvedValue({
            synthetic: true,
            status: 'FAILED',
            results: [],
          } as never),
      ];
      for (const change of mutate) {
        const b = adapters();
        change(b);
        await expect(
          verifyWorkspace(options, expected, b, { root }),
        ).rejects.toThrow();
        const saved = JSON.parse(
          await readFile(
            join(root, '.wrangler/workspaces/event-alpha/journal.json'),
            'utf8',
          ),
        );
        expect(saved.verification?.connection).not.toBe('VERIFIED');
      }
    }));
});

it('retirement requires fresh success and reverifies replacement before contacting exact old origin', async () => {
  await temporary(async (root) => {
    const a = adapters();
    await provisionWorkspace(options, a, { root });
    const oldToken = join(root, 'old-token');
    await writeFile(oldToken, 'old-private-token', { mode: 0o600 });
    const expected = {
      appId: 42,
      appSlug: 'event-app',
      installationId: 84,
      repositories: [`${options.organization}/project`],
    };
    const journal = join(root, '.wrangler/workspaces/event-alpha/journal.json');
    const oldConfig = join(root, 'old-config.json');
    await writeFile(
      oldConfig,
      JSON.stringify({
        name: 'old-worker',
        workflows: [
          { binding: 'EVALUATOR', name: 'old-evaluator' },
          { binding: 'ORG_EVALUATOR', name: 'old-org-evaluator' },
        ],
        kv_namespaces: [{ binding: 'ARTIFACT_KV', id: 'd'.repeat(32) }],
        vars: {
          ORG_NAME: 'Old-Org',
          ORG_PUBLIC_ORIGIN: 'https://old.example.org',
        },
        d1_databases: [
          {
            binding: 'DB',
            database_id: '99999999-9999-9999-9999-999999999999',
          },
          {
            binding: 'ORG_DB',
            database_id: '88888888-8888-8888-8888-888888888888',
          },
        ],
      }),
      { mode: 0o600 },
    );
    const old = {
      configFile: oldConfig,
      origin: 'https://old.example.org',
      organization: 'Old-Org',
      tokenFile: oldToken,
    };
    const retire = vi.fn(async (..._args: any[]) => ({
      retirement: { state: 'RETIRED' },
    }));
    const status = a.workspaceStatus.getMockImplementation()!;
    (a.workspaceStatus as any).mockImplementation(async (origin: string) =>
      origin === old.origin
        ? {
            authenticated: true,
            role: 'organizer',
            organization: 'Old-Org',
            app: { id: 99, installationId: 199, slug: 'old-app' },
            retirement: { state: 'ACTIVE' },
          }
        : status(),
    );
    const b = { ...a, retireWorkspace: retire };
    await expect(
      retireWorkspace({ journal, old }, b, { root }),
    ).rejects.toThrow('fresh VERIFIED');
    expect(retire).not.toHaveBeenCalled();
    await verifyWorkspace(options, expected, a, { root });
    const originalConfig = await readFile(oldConfig, 'utf8');
    const sharedWorkflow = JSON.parse(originalConfig);
    sharedWorkflow.workflows[1].name =
      'judge-c2c-event-alpha-organization-evaluator';
    await writeFile(oldConfig, JSON.stringify(sharedWorkflow), { mode: 0o600 });
    const requestsBefore = a.workspaceStatus.mock.calls.length;
    await expect(
      retireWorkspace({ journal, old }, b, { root }),
    ).rejects.toThrow('distinct resource');
    expect(a.workspaceStatus.mock.calls.length).toBe(requestsBefore);
    await writeFile(oldConfig, originalConfig, { mode: 0o600 });
    const result = await retireWorkspace({ journal, old }, b, { root });
    expect(result.retirement.state).toBe('RETIRED');
    expect(retire.mock.calls[0]?.[0]).toBe(old.origin);
    expect(retire.mock.calls[0]?.[1]).toBe('old-private-token');
    expect((retire.mock.calls as any)[0][2].replacement.organization).toBe(
      options.organization,
    );
    expect(a.runnerDiagnostic).toHaveBeenCalledTimes(2);
    await expect(
      retireWorkspace(
        { journal, old: { ...old, organization: options.organization } },
        b,
        { root },
      ),
    ).rejects.toThrow('distinct');
    const saved = JSON.parse(await readFile(journal, 'utf8'));
    saved.verification.connection = 'FAILED';
    await writeFile(journal, JSON.stringify(saved), { mode: 0o600 });
    await expect(
      retireWorkspace({ journal, old }, b, { root }),
    ).rejects.toThrow('fresh VERIFIED');
    expect(retire).toHaveBeenCalledTimes(1);
  });
});
