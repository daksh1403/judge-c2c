import {
  readFile,
  writeFile,
  mkdir,
  chmod,
  rename,
  lstat,
  open,
  unlink,
} from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parse } from 'jsonc-parser';
import { buildProductionConfig, workspaceNames } from './production-config.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hex = /^[a-f0-9]{32}$/;
const requiredPermissions = {
  contents: 'read',
  pull_requests: 'read',
  issues: 'write',
  checks: 'write',
};
export function validateWorkspace(options) {
  const o = { ...options };
  if (
    typeof o.organization !== 'string' ||
    o.organization.length > 39 ||
    !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(o.organization)
  )
    throw new Error('Invalid GitHub organization name');
  const names = workspaceNames(o.workspace);
  if (!hex.test(o.accountId)) throw new Error('Invalid Cloudflare account ID');
  if (
    !['cloudflare', 'callmissed'].includes(o.provider) ||
    typeof o.model !== 'string' ||
    o.model.length > 200 ||
    !/^[A-Za-z0-9@/._:-]+$/.test(o.model)
  )
    throw new Error('Invalid AI provider/model');
  const origin = (value) => {
    let u;
    try {
      u = new URL(value);
    } catch {
      throw new Error('Invalid HTTPS origin');
    }
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.pathname !== '/' ||
      u.search ||
      u.hash ||
      /(^|[.-])(localhost|local|review|preview|feat|test)([.-]|$)/i.test(
        u.hostname,
      ) ||
      !u.hostname
        .split('.')
        .every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) ||
      u.hostname.split('.').length < 2 ||
      /^[0-9.]+$/.test(u.hostname)
    )
      throw new Error('Invalid isolated HTTPS origin');
    return u;
  };
  const publicUrl = origin(o.origin),
    runner = origin(o.runnerEndpoint);
  if (publicUrl.port || publicUrl.origin === runner.origin)
    throw new Error('Workspace requires a separate origin and isolated runner');
  if (
    /(^|\.)workers\.dev$/.test(publicUrl.hostname) &&
    (o.runnerMode !== 'OWNER_TUNNEL' ||
      typeof o.workersSubdomain !== 'string' ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(o.workersSubdomain) ||
      publicUrl.hostname !==
        `${names.worker}.${o.workersSubdomain}.workers.dev`)
  )
    throw new Error(
      'Workspace workers.dev origin must match its exact Worker and account subdomain in owner tunnel mode',
    );
  o.origin = publicUrl.origin;
  o.runnerEndpoint = runner.origin;
  o.runnerMode ??= 'MANAGED';
  if (
    !['MANAGED', 'OWNER_TUNNEL'].includes(o.runnerMode) ||
    !(
      o.runnerMode === 'MANAGED'
        ? /^registry\.cloudflare\.com\/[A-Za-z0-9/_-]+@sha256:[a-f0-9]{64}$/
        : /^docker-local@sha256:[a-f0-9]{64}$/
    ).test(o.runnerImage) ||
    (o.runnerMode === 'OWNER_TUNNEL' &&
      !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/.test(
        o.runnerEndpoint,
      ))
  )
    throw new Error('Invalid isolated digest-pinned runner');
  return { target: o, names };
}
const fingerprint = (target) =>
  createHash('sha256').update(JSON.stringify(target)).digest('hex');
const resourceList = (names) => [
  { kind: 'worker', name: names.worker },
  { kind: 'workflow', name: names.evaluator },
  { kind: 'workflow', name: names.organizationEvaluator },
  { kind: 'database', name: names.database },
  { kind: 'database', name: names.organizationDatabase },
  { kind: 'kv', name: names.kv },
  { kind: 'bucket', name: names.bucket },
];
function validateInventory(resources, inventory, known, target, journal) {
  if (
    known.some(
      (r) =>
        r.origin === target.origin || resources.some((w) => r.name === w.name),
    )
  )
    throw new Error('Known production/native/review resource reuse collision');
  for (const r of resources) {
    if (!Array.isArray(inventory[r.kind]))
      throw new Error('Incomplete remote resource inventory');
    const matches = inventory[r.kind].filter((x) => x.name === r.name);
    const saved = journal?.resources[r.name];
    if (saved) {
      if (
        matches.length !== 1 ||
        matches[0].id !== saved.id ||
        known.some((k) => k.id === saved.id)
      )
        throw new Error('Resumed resource identity changed or missing');
    } else if (journal?.deployed && ['worker', 'workflow'].includes(r.kind)) {
      if (matches.length !== 1)
        throw new Error('Deployed runtime identity missing');
    } else if (matches.length)
      throw new Error(
        'Existing resource name collision; resources cannot be adopted',
      );
  }
}
async function inspect(options, adapters, journal) {
  const { target, names } = validateWorkspace(options);
  const actor = await adapters.githubIdentity();
  if (!actor?.login) throw new Error('Authenticated GitHub identity required');
  const membership = await adapters.githubMembership(target.organization);
  if (membership?.state !== 'active' || membership.role !== 'admin')
    throw new Error('Active GitHub organization admin membership required');
  const known = await adapters.knownResources(),
    inventory = await adapters.inventory(target.accountId);
  const resources = resourceList(names);
  validateInventory(resources, inventory, known, target, journal);
  return { target, names, actor: actor.login, resources };
}
export async function planWorkspace(options, adapters) {
  const p = await inspect(options, adapters);
  return {
    organization: p.target.organization,
    workspace: p.target.workspace,
    actor: p.actor,
    origin: p.target.origin,
    resources: p.resources,
    runner: { endpoint: p.target.runnerEndpoint, image: p.target.runnerImage },
    provider: { name: p.target.provider, model: p.target.model },
    mode: 'PLAN',
    deployment:
      'Explicit --apply --deploy and clean main at origin/main required',
  };
}
function paths(root, workspace) {
  const directory = resolve(root, '.wrangler/workspaces', workspace);
  return {
    directory,
    journal: resolve(directory, 'journal.json'),
    config: resolve(directory, 'config.json'),
    lock: resolve(directory, 'setup.lock'),
  };
}
async function privateDirectory(root, workspace) {
  for (const path of [
    resolve(root, '.wrangler'),
    resolve(root, '.wrangler/workspaces'),
    paths(root, workspace).directory,
  ]) {
    await mkdir(path, { mode: 0o700 }).catch((e) => {
      if (e.code !== 'EEXIST') throw e;
    });
    if (!(await lstat(path)).isDirectory())
      throw new Error('Private workspace directory must not be a symlink');
    await chmod(path, 0o700);
  }
}
async function readJournal(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || (info.mode & 0o777) !== 0o600)
      throw new Error('Journal must be a private mode-0600 regular file');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function saveJournal(path, journal) {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(journal, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, path);
}
function assertJournal(journal, target) {
  if (
    !journal ||
    journal.version !== 1 ||
    journal.targetHash !== fingerprint(target) ||
    fingerprint(journal.target) !== journal.targetHash ||
    !journal.resources ||
    !journal.secrets ||
    !journal.stages
  )
    throw new Error('Private journal target mismatch or invalid state');
}
async function locked(root, workspace, run) {
  await privateDirectory(root, workspace);
  const p = paths(root, workspace);
  const lock = await open(p.lock, 'wx', 0o600).catch(() => {
    throw new Error(
      'Workspace operation already locked; inspect an interrupted process before removing its private lock',
    );
  });
  try {
    return await run(p);
  } finally {
    await lock.close();
    await unlink(p.lock);
  }
}
function configEnvironment(target, names, resources) {
  return {
    CLOUDFLARE_WORKERS_SUBDOMAIN: target.workersSubdomain,
    PRODUCTION_WORKSPACE_NAME: target.workspace,
    PRODUCTION_DATABASE_ID: resources[names.database]?.id,
    PRODUCTION_ORG_DATABASE_ID: resources[names.organizationDatabase]?.id,
    PRODUCTION_ARTIFACT_KV_ID: resources[names.kv]?.id,
    PRODUCTION_ARTIFACT_BUCKET: names.bucket,
    PUBLIC_ORIGIN: target.origin,
    PRODUCTION_ORG_PUBLIC_ORIGIN: target.origin,
    PRODUCTION_ORG_NAME: target.organization,
    PRODUCTION_AI_PROVIDER: target.provider,
    PRODUCTION_AI_MODEL: target.model,
    PRODUCTION_RUNNER_ENDPOINT: target.runnerEndpoint,
    PRODUCTION_RUNNER_IMAGE: target.runnerImage,
    PRODUCTION_RUNNER_MODE: target.runnerMode,
  };
}
export async function provisionWorkspace(
  options,
  adapters,
  { root = process.cwd(), deploy = false, providerKey } = {},
) {
  const { target } = validateWorkspace(options);
  if (
    target.provider === 'callmissed' &&
    (!providerKey || providerKey.length < 16 || providerKey.length > 1000)
  )
    throw new Error(
      'Callmissed requires an explicit fresh private provider-key file',
    );
  if (deploy) await adapters.approvedRuntime();
  // Authorize and validate the remote names before creating any private state.
  const prior = await readJournal(paths(root, target.workspace).journal);
  if (prior) assertJournal(prior, target);
  const p = await inspect(target, adapters, prior);
  return locked(root, target.workspace, async (files) => {
    let journal = await readJournal(files.journal);
    if (journal) assertJournal(journal, target);
    else {
      const secrets = Object.fromEntries(
        [
          'ORG_ADMIN_TOKEN',
          'ORG_JUDGE_TOKEN',
          'ORG_SECURITY_TOKEN',
          'ORG_VAULT_KEY',
          'ADMIN_TOKEN',
          'RUNNER_TUNNEL_KEY',
        ].map((k) => [k, randomBytes(32).toString('hex')]),
      );
      if (target.provider === 'callmissed')
        secrets.CALLMISSED_API_KEY = providerKey;
      journal = {
        version: 1,
        target,
        targetHash: fingerprint(target),
        actor: p.actor,
        resources: {},
        secrets,
        stages: [],
        deployed: false,
      };
      await saveJournal(files.journal, journal);
    }
    if (!prior)
      await writeFile(
        files.config,
        JSON.stringify({ name: p.names.worker, account_id: target.accountId }) +
          '\n',
        { mode: 0o600, flag: 'wx' },
      );
    if (journal.pending)
      throw new Error(
        'Ambiguous interrupted resource creation; inspect the remote resource and journal before continuing, never adopt an existing resource',
      );
    const stage = async (label, operation) => {
      if (journal.stages.includes(label)) return;
      try {
        await operation();
        journal.stages.push(label);
        journal.failure = null;
        await saveJournal(files.journal, journal);
      } catch {
        journal.failure = { stage: label, at: new Date().toISOString() };
        await saveJournal(files.journal, journal);
        throw new Error(
          `Workspace failed at ${label}; private journal retained for safe resume`,
        );
      }
    };
    for (const resource of p.resources.filter(
      (r) => !['worker', 'workflow'].includes(r.kind),
    )) {
      await stage(`create:${resource.name}`, async () => {
        journal.pending = resource;
        await saveJournal(files.journal, journal);
        const created = await adapters.createResource(
          resource.kind,
          resource.name,
          files.config,
        );
        if (
          created?.name !== resource.name ||
          !(
            resource.kind === 'database'
              ? uuid
              : resource.kind === 'kv'
                ? hex
                : /^[a-z0-9-]{3,63}$/
          ).test(created.id)
        )
          throw new Error('Created resource identity mismatch');
        if (
          Object.values(journal.resources).some((r) => r.id === created.id) ||
          (await adapters.knownResources()).some((r) => r.id === created.id)
        )
          throw new Error('Created resource identity reuse');
        journal.resources[resource.name] = created;
        journal.pending = null;
      });
    }
    const config = await buildProductionConfig(
      configEnvironment(target, p.names, journal.resources),
      { root },
    );
    config.account_id = target.accountId;
    await writeFile(files.config, JSON.stringify(config, null, 2) + '\n', {
      mode: 0o600,
    });
    await chmod(files.config, 0o600);
    for (const binding of ['DB', 'ORG_DB'])
      await stage(`migration:${binding}`, () =>
        adapters.migrate(binding, files.config),
      );
    // Wrangler secrets put requires a Worker to exist. It creates only an empty, nonfunctional shell before explicit deployment.
    for (const [name, value] of Object.entries(journal.secrets))
      await stage(`secret:${name}`, async () => {
        await adapters.secret(name, value, files.config);
        if (!journal.resources[p.names.worker]) {
          const inventory = await adapters.inventory(target.accountId);
          const matches = inventory.worker.filter(
            (r) => r.name === p.names.worker,
          );
          if (matches.length !== 1)
            throw new Error('Secret Worker shell identity unavailable');
          journal.resources[p.names.worker] = matches[0];
        }
      });
    if (deploy)
      await stage('deploy', async () => {
        await adapters.approvedRuntime();
        await adapters.deploy(files.config);
        journal.deployed = true;
      });
    return {
      organization: target.organization,
      workspace: target.workspace,
      origin: target.origin,
      state: journal.deployed ? 'DEPLOYED' : 'PROVISIONED',
      journal: files.journal,
      connection: 'UNVERIFIED',
    };
  });
}
function expectedConnection(target, expected) {
  if (
    !Number.isSafeInteger(expected.appId) ||
    expected.appId < 1 ||
    !Number.isSafeInteger(expected.installationId) ||
    expected.installationId < 1 ||
    typeof expected.appSlug !== 'string' ||
    !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(expected.appSlug) ||
    !Array.isArray(expected.repositories) ||
    !expected.repositories.length ||
    expected.repositories.length > 1000 ||
    new Set(expected.repositories).size !== expected.repositories.length ||
    expected.repositories.some(
      (r) =>
        typeof r !== 'string' ||
        !new RegExp(`^${target.organization}/[A-Za-z0-9._-]{1,100}$`, 'i').test(
          r,
        ),
    )
  )
    throw new Error(
      'Expected exact App, installation and selected repository names required',
    );
}
export async function verifyWorkspace(
  options,
  expected,
  adapters,
  { root = process.cwd() } = {},
) {
  const { target } = validateWorkspace(options);
  expectedConnection(target, expected);
  return locked(root, target.workspace, async (files) => {
    const journal = await readJournal(files.journal);
    assertJournal(journal, target);
    // Invalidate prior success before any remote request, including provider failures.
    journal.verification = {
      connection: 'PENDING',
      at: new Date().toISOString(),
    };
    await saveJournal(files.journal, journal);
    try {
      const actor = await adapters.githubIdentity(),
        membership = await adapters.githubMembership(target.organization);
      if (
        !actor?.login ||
        membership?.state !== 'active' ||
        membership.role !== 'admin'
      )
        throw new Error('GitHub admin authentication required');
      const status = await adapters.workspaceStatus(
        target.origin,
        journal.secrets.ORG_ADMIN_TOKEN,
      );
      if (
        status?.authenticated !== true ||
        status.role !== 'organizer' ||
        status.organization !== target.organization ||
        status.app?.id !== expected.appId ||
        status.app?.installationId !== expected.installationId ||
        status.app?.slug !== expected.appSlug ||
        status.runner?.enabled !== true
      )
        throw new Error('Authenticated workspace target identity mismatch');
      const app = await adapters.app(expected.appSlug),
        installation = await adapters.installation(
          target.organization,
          expected.installationId,
        );
      if (
        app?.id !== expected.appId ||
        app.slug !== expected.appSlug ||
        app.owner?.type !== 'Organization' ||
        app.owner.login.toLowerCase() !== target.organization.toLowerCase() ||
        installation?.id !== expected.installationId ||
        installation.app_id !== expected.appId ||
        installation.account?.type !== 'Organization' ||
        installation.account.login.toLowerCase() !==
          target.organization.toLowerCase() ||
        installation.suspended_at ||
        !['selected', 'all'].includes(installation.repository_selection) ||
        Object.entries(requiredPermissions).some(
          ([key, value]) => installation.permissions?.[key] !== value,
        ) ||
        Object.entries(installation.permissions ?? {}).some(([key, value]) =>
          key === 'metadata'
            ? value !== 'read'
            : requiredPermissions[key] !== value,
        )
      )
        throw new Error(
          'GitHub App installation ownership or permissions mismatch',
        );
      const repositories = await adapters.repositories(
        target.origin,
        journal.secrets.ORG_ADMIN_TOKEN,
      );
      if (
        !Array.isArray(repositories) ||
        repositories.some(
          (r) =>
            typeof r.full_name !== 'string' ||
            r.full_name.split('/')[0].toLowerCase() !==
              target.organization.toLowerCase() ||
            r.accessible !== 1,
        ) ||
        expected.repositories.some(
          (name) =>
            !repositories.some(
              (r) => r.full_name.toLowerCase() === name.toLowerCase(),
            ),
        )
      )
        throw new Error('Selected repository access unavailable');
      const diagnostic = await adapters.runnerDiagnostic(
        target.origin,
        journal.secrets.ORG_ADMIN_TOKEN,
      );
      // The authenticated Worker validates both runner HMAC response signatures before returning COMPLETED.
      if (
        diagnostic?.synthetic !== true ||
        diagnostic.status !== 'COMPLETED' ||
        diagnostic.results?.length !== 2 ||
        diagnostic.results[0]?.label !== 'baseline' ||
        diagnostic.results[0]?.result?.checks?.[0]?.status !== 'FAIL' ||
        diagnostic.results[1]?.label !== 'submission' ||
        diagnostic.results[1]?.result?.checks?.[0]?.status !== 'PASS'
      )
        throw new Error('Signed runner diagnostic unavailable or failed');
      let provider = 'UNAVAILABLE';
      try {
        const result = await adapters.providerDiagnostic(
          target.origin,
          journal.secrets.ORG_ADMIN_TOKEN,
        );
        if (result?.synthetic === true && result.status === 'COMPLETED')
          provider = 'COMPLETED';
      } catch {
        /* Provider unavailability is visible and cannot become functional evidence. */
      }
      const record = {
        reference: randomBytes(16).toString('hex'),
        connection: 'VERIFIED',
        organization: target.organization,
        workspace: target.workspace,
        origin: target.origin,
        targetHash: journal.targetHash,
        appId: expected.appId,
        appSlug: expected.appSlug,
        installationId: expected.installationId,
        repositories: expected.repositories,
        actor: actor.login,
        at: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        runner: 'SIGNED_SYNTHETIC_COMPLETED',
        provider,
        functionalEvaluation: 'UNVERIFIED',
      };
      journal.verification = record;
      await saveJournal(files.journal, journal);
      return record;
    } catch (error) {
      journal.verification = {
        connection: 'FAILED',
        at: new Date().toISOString(),
      };
      await saveJournal(files.journal, journal);
      throw new Error(
        'Connection verification failed; exact identity, permissions, selected access and signed runner are required. Private verification record is FAILED.',
      );
    }
  });
}

async function runCommand(executable, args, { input, env, cwd } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let size = 0;
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) child.kill();
      else stdout += chunk;
    });
    // Never forward external stderr: it can contain credentials or participant text.
    child.stderr.resume();
    child.on('error', () => reject(new Error('Operator command unavailable')));
    child.on('close', (code) =>
      code === 0 && size <= 8 * 1024 * 1024
        ? accept(stdout)
        : reject(
            new Error(
              'Operator command failed; inspect private operator tooling without exposing credentials',
            ),
          ),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}
export function createAdapters({
  root = process.cwd(),
  env = process.env,
  command = runCommand,
  request = fetch,
} = {}) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const commandEnv = Object.fromEntries(
    [
      'PATH',
      'HOME',
      'TMPDIR',
      'GH_TOKEN',
      'GH_HOST',
      'GH_CONFIG_DIR',
      'GITHUB_TOKEN',
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
    ]
      .filter((key) => env[key])
      .map((key) => [key, env[key]]),
  );
  commandEnv.CI = 'true';
  commandEnv.WRANGLER_SEND_METRICS = 'false';
  commandEnv.WRANGLER_LOG = 'error';
  const gh = async (args) =>
    command('gh', args, { cwd: root, env: commandEnv });
  const github = async (path) =>
    JSON.parse(await gh(['api', path, '--method', 'GET']));
  const wrangler = async (args, input) => {
    const pkg = JSON.parse(
      await readFile(resolve(root, 'package.json'), 'utf8'),
    );
    const installed = JSON.parse(
      await readFile(
        resolve(root, 'node_modules/wrangler/package.json'),
        'utf8',
      ),
    );
    if (
      pkg.devDependencies.wrangler !== installed.version ||
      !/^\d+\.\d+\.\d+$/.test(installed.version)
    )
      throw new Error('Pinned local Wrangler version mismatch');
    return command(
      'node',
      [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), ...args],
      { input, cwd: root, env: commandEnv },
    );
  };
  const cloudflare = async (path) => {
    if (!hex.test(accountId) || !env.CLOUDFLARE_API_TOKEN)
      throw new Error(
        'Explicit Cloudflare account and authenticated API token required',
      );
    const response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/${path}`,
      {
        headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      },
    );
    const body = await response.json();
    if (!response.ok || body.success !== true)
      throw new Error('Cloudflare inventory authentication failed');
    return body;
  };
  const list = async (path, field) => {
    const results = [];
    for (let page = 1; page <= 100; page++) {
      const body = await cloudflare(`${path}?per_page=100&page=${page}`);
      const values = field ? body.result?.[field] : body.result;
      if (!Array.isArray(values))
        throw new Error('Cloudflare resource inventory unavailable');
      results.push(...values);
      if (
        body.result_info?.total_pages
          ? page >= body.result_info.total_pages
          : values.length < 100
      )
        return results;
    }
    throw new Error('Cloudflare resource inventory limit exceeded');
  };
  let cookie;
  const workspaceRequest = async (origin, token, path, method = 'GET') => {
    // Each adapter session is bound to one exact origin and fresh organizer token.
    if (!cookie || cookie.origin !== origin || cookie.token !== token) {
      const response = await request(`${origin}/api/organization/login`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      const session = response.headers.get('set-cookie');
      if (!response.ok || !session || !(await response.json()).authenticated)
        throw new Error('Organizer workspace authentication failed');
      cookie = { origin, token, value: session.split(';')[0] };
    }
    const response = await request(`${origin}${path}`, {
      method,
      headers: { origin, cookie: cookie.value },
      redirect: 'error',
      signal: AbortSignal.timeout(method === 'POST' ? 120000 : 30000),
    });
    if (!response.ok)
      throw new Error('Authenticated workspace API unavailable');
    return response.json();
  };
  const adapters = {
    githubIdentity: async () => {
      await gh(['auth', 'status']);
      return github('/user');
    },
    githubMembership: (organization) =>
      github(`/user/memberships/orgs/${organization}`),
    knownResources: async () => {
      const paths = [
        resolve(root, 'wrangler.jsonc'),
        resolve(root, '.wrangler/production.json'),
      ];
      const resources = [];
      for (const path of paths) {
        let raw;
        try {
          raw = parse(await readFile(path, 'utf8'));
        } catch (error) {
          if (error.code === 'ENOENT' && path.endsWith('production.json'))
            continue;
          throw new Error('Known resource configuration unreadable');
        }
        for (const config of [
          raw,
          raw.previews,
          ...Object.values(raw.env ?? {}),
        ].filter(Boolean)) {
          if (config.name) resources.push({ name: config.name });
          resources.push(
            ...(config.workflows ?? []).map((w) => ({ name: w.name })),
            ...(config.d1_databases ?? []).map((d) => ({
              name: d.database_name,
              id: d.database_id,
            })),
            ...(config.kv_namespaces ?? []).map((k) => ({ id: k.id })),
            ...(config.r2_buckets ?? []).map((b) => ({
              name: b.bucket_name,
              id: b.bucket_name,
            })),
          );
          for (const origin of [
            config.vars?.PUBLIC_ORIGIN,
            config.vars?.ORG_PUBLIC_ORIGIN,
            ...(config.vars?.ORG_REVIEW_ORIGINS ?? '').split(','),
          ].filter(Boolean))
            resources.push({ origin: new URL(origin).origin });
        }
      }
      return resources;
    },
    inventory: async (expectedAccount) => {
      if (expectedAccount !== accountId)
        throw new Error('Cloudflare account identity mismatch');
      const [database, kv, bucket, worker, workflow] = await Promise.all([
        list('d1/database'),
        list('storage/kv/namespaces'),
        list('r2/buckets', 'buckets'),
        list('workers/scripts'),
        list('workflows'),
      ]);
      return {
        database: database.map((d) => ({ name: d.name, id: d.uuid })),
        kv: kv.map((k) => ({ name: k.title, id: k.id })),
        bucket: bucket.map((b) => ({ name: b.name, id: b.name })),
        worker: worker.map((w) => ({ name: w.id, id: w.id })),
        workflow: workflow.map((w) => ({ name: w.name, id: w.id ?? w.name })),
      };
    },
    createResource: async (kind, name, config) => {
      const args =
        kind === 'database'
          ? ['d1', 'create', name, '--update-config=false']
          : kind === 'kv'
            ? ['kv', 'namespace', 'create', name, '--update-config=false']
            : kind === 'bucket'
              ? ['r2', 'bucket', 'create', name]
              : null;
      if (!args) throw new Error('Unsupported fresh resource type');
      await wrangler([...args, '--config', config]);
      const inventory = await adapters.inventory(accountId),
        matches = inventory[kind].filter((r) => r.name === name);
      if (matches.length !== 1)
        throw new Error('Fresh resource cannot be identified');
      return matches[0];
    },
    migrate: (binding, config) =>
      wrangler([
        'd1',
        'migrations',
        'apply',
        binding,
        '--remote',
        '--config',
        config,
      ]),
    secret: async (name, value, config) => {
      await wrangler(['secret', 'put', name, '--config', config], value);
    },
    deploy: (config) => wrangler(['deploy', '--config', config]),
    approvedRuntime: async () => {
      const git = (args) =>
        command('git', args, { cwd: root, env: commandEnv });
      if (
        (await git(['branch', '--show-current'])).trim() !== 'main' ||
        (await git(['status', '--porcelain'])).trim()
      )
        throw new Error(
          'Explicit deployment requires clean main at origin/main; feature runtime must be owner-approved first',
        );
      await git(['fetch', 'origin', 'main']);
      const head = (await git(['rev-parse', 'HEAD'])).trim(),
        approved = (await git(['rev-parse', 'origin/main'])).trim();
      if (!/^[a-f0-9]{40}$/.test(head) || head !== approved)
        throw new Error(
          'Explicit deployment requires clean main at origin/main',
        );
    },
    workspaceStatus: (origin, token) =>
      workspaceRequest(origin, token, '/api/organization/status'),
    app: (slug) => github(`/apps/${slug}`),
    installation: async (organization, id) => {
      const all = [];
      for (let page = 1; page <= 100; page++) {
        const body = await github(
          `/orgs/${organization}/installations?per_page=100&page=${page}`,
        );
        if (!Array.isArray(body.installations))
          throw new Error('GitHub installation inventory unavailable');
        all.push(...body.installations);
        if (body.installations.length < 100) {
          const matches = all.filter((i) => i.id === id);
          if (matches.length !== 1)
            throw new Error('Expected installation not found');
          return matches[0];
        }
      }
      throw new Error('GitHub installation inventory limit exceeded');
    },
    repositories: async (origin, token) => {
      await workspaceRequest(origin, token, '/api/organization/sync', 'POST');
      const data = await workspaceRequest(
        origin,
        token,
        '/api/organization/repositories',
      );
      return data.repositories.filter((r) => r.accessible === 1);
    },
    runnerDiagnostic: (origin, token) =>
      workspaceRequest(origin, token, '/api/organization/runner-check', 'POST'),
    providerDiagnostic: (origin, token) =>
      workspaceRequest(
        origin,
        token,
        '/api/organization/reviewer-check',
        'POST',
      ),
  };
  return adapters;
}
export async function main(
  args = process.argv.slice(2),
  {
    env = process.env,
    root = process.cwd(),
    adapters = createAdapters({ root, env }),
  } = {},
) {
  const values = {},
    repositories = [];
  let verify = false,
    apply = false,
    deploy = false;
  const allowed = new Set([
    'organization',
    'workspace',
    'origin',
    'account-id',
    'runner-endpoint',
    'runner-image',
    'runner-mode',
    'workers-subdomain',
    'provider',
    'model',
    'provider-key-file',
    'app-id',
    'app-slug',
    'installation-id',
    'repository',
  ]);
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === 'verify' || argument === '--verify') {
      verify = true;
      continue;
    }
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--deploy') {
      deploy = true;
      continue;
    }
    const key = argument?.replace(/^--/, '');
    if (
      !argument?.startsWith('--') ||
      !allowed.has(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--') ||
      values[key]
    )
      throw new Error('Unknown, duplicate or missing CLI option');
    const value = args[++i];
    if (key === 'repository') repositories.push(value);
    else values[key] = value;
  }
  if ((deploy && !apply) || (verify && (apply || deploy)))
    throw new Error(
      'Deployment requires --apply --deploy; verification is separate',
    );
  const options = {
    organization: values.organization,
    workspace: values.workspace,
    accountId: values['account-id'] ?? env.CLOUDFLARE_ACCOUNT_ID,
    origin: values.origin ?? env.PUBLIC_ORIGIN,
    runnerEndpoint: values['runner-endpoint'] ?? env.PRODUCTION_RUNNER_ENDPOINT,
    runnerImage: values['runner-image'] ?? env.PRODUCTION_RUNNER_IMAGE,
    workersSubdomain:
      values['workers-subdomain'] ?? env.CLOUDFLARE_WORKERS_SUBDOMAIN,
    runnerMode:
      values['runner-mode'] ?? env.PRODUCTION_RUNNER_MODE ?? 'MANAGED',
    provider: values.provider ?? env.PRODUCTION_AI_PROVIDER,
    model: values.model ?? env.PRODUCTION_AI_MODEL,
  };
  if (verify)
    return verifyWorkspace(
      options,
      {
        appId: Number(values['app-id']),
        appSlug: values['app-slug'],
        installationId: Number(values['installation-id']),
        repositories,
      },
      adapters,
      { root },
    );
  if (!apply) return planWorkspace(options, adapters);
  let providerKey;
  if (values['provider-key-file']) {
    const path = resolve(values['provider-key-file']);
    const info = await lstat(path);
    if (!info.isFile() || (info.mode & 0o777) !== 0o600)
      throw new Error('Provider key must use a private mode-0600 regular file');
    providerKey = (await readFile(path, 'utf8')).trim();
  }
  return provisionWorkspace(options, adapters, { root, deploy, providerKey });
}
export { paths, readJournal, saveJournal, assertJournal, fingerprint };
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(await main(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
