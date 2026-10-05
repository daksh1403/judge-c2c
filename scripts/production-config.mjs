import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { isIP } from 'node:net';

export function workspaceNames(workspace) {
  if (
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(workspace) ||
    workspace.length > 30 ||
    /(^|-)(production|local|review|preview|feat|test)(-|$)/.test(workspace)
  )
    throw new Error('Invalid or reserved workspace name');
  const worker = `judge-c2c-${workspace}`;
  return {
    worker,
    evaluator: `${worker}-evaluator`,
    organizationEvaluator: `${worker}-organization-evaluator`,
    database: `${worker}-evaluations`,
    organizationDatabase: `${worker}-organization`,
    kv: `${worker}-artifact-kv`,
    bucket: `${worker}-artifacts`,
  };
}
export async function buildProductionConfig(
  env = process.env,
  { root = process.cwd(), outputPath } = {},
) {
  const workspace = env.PRODUCTION_WORKSPACE_NAME;
  const names = workspace
    ? workspaceNames(workspace)
    : {
        worker: 'judge-c2c-production',
        evaluator: 'judge-c2c-production-evaluator',
        organizationEvaluator: 'judge-c2c-organization-production-evaluator',
        database: 'judge-c2c-production',
        organizationDatabase: 'judge-c2c-organization-production',
      };
  const output =
    outputPath ??
    env.PRODUCTION_CONFIG_PATH ??
    (workspace
      ? `.wrangler/workspaces/${workspace}/config.json`
      : '.wrangler/production.json');
  if (
    output !==
    (workspace
      ? `.wrangler/workspaces/${workspace}/config.json`
      : '.wrangler/production.json')
  )
    throw new Error('Invalid private config output path');
  const sourcePath = (path) =>
    relative(dirname(resolve(root, output)), resolve(root, path)).replaceAll(
      '\\',
      '/',
    );
  // Read identifiers only to deny reuse; never inherit review bindings or values.
  const existing = parse(
    await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'),
  );
  const current = workspace
    ? await readFile(resolve(root, '.wrangler/production.json'), 'utf8')
        .then(parse)
        .catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        })
    : null;
  const nonproduction = [
    current,
    existing,
    existing.previews,
    ...Object.values(existing.env ?? {}),
  ].filter(Boolean);
  const forbiddenIds = new Set(
    nonproduction.flatMap((c) => [
      ...(c.d1_databases ?? []).map((d) => d.database_id),
      ...(c.kv_namespaces ?? []).map((k) => k.id),
    ]),
  );
  const forbiddenBuckets = new Set(
    nonproduction.flatMap((c) =>
      (c.r2_buckets ?? []).map((b) => b.bucket_name),
    ),
  );
  const forbiddenOrigins = new Set(
    nonproduction
      .flatMap((c) => [
        c.vars?.PUBLIC_ORIGIN,
        c.vars?.ORG_PUBLIC_ORIGIN,
        ...(c.vars?.ORG_REVIEW_ORIGINS ?? '').split(','),
      ])
      .filter(Boolean)
      .map((v) => new URL(v).origin),
  );
  const input = (key) => {
    const value = env[key];
    if (!value || value.trim() !== value) throw new Error(`Set ${key}`);
    return value;
  };
  const runnerMode = env.PRODUCTION_RUNNER_MODE || 'MANAGED';
  if (!['MANAGED', 'OWNER_TUNNEL'].includes(runnerMode))
    throw new Error('Invalid PRODUCTION_RUNNER_MODE');
  const resourceId = (key, pattern) => {
    const value = input(key);
    if (!pattern.test(value) || forbiddenIds.has(value))
      throw new Error(`${key} must be a separate production resource`);
    return value;
  };
  const httpsOrigin = (key) => {
    const value = input(key);
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      forbiddenOrigins.has(url.origin) ||
      /(^|[.-])(localhost|local|review|preview|feat|test)([.-]|$)/i.test(
        url.hostname,
      )
    )
      throw new Error(`${key} must be a separate HTTPS production origin`);
    return url.origin;
  };
  const database = resourceId(
    'PRODUCTION_DATABASE_ID',
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
  );
  const organizationDatabase = resourceId(
    'PRODUCTION_ORG_DATABASE_ID',
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
  );
  if (database === organizationDatabase)
    throw new Error('Production DB and ORG_DB must be separate');
  const artifactKv = resourceId('PRODUCTION_ARTIFACT_KV_ID', /^[a-f0-9]{32}$/);
  const bucket =
    runnerMode === 'OWNER_TUNNEL' && !env.PRODUCTION_ARTIFACT_BUCKET
      ? null
      : input('PRODUCTION_ARTIFACT_BUCKET');
  if (
    bucket !== null &&
    (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket) ||
      forbiddenBuckets.has(bucket) ||
      /(^|-)(local|review|preview|test)(-|$)/.test(bucket))
  )
    throw new Error(
      'PRODUCTION_ARTIFACT_BUCKET must be a separate production bucket',
    );
  const origin = httpsOrigin('PUBLIC_ORIGIN');
  const publicUrl = new URL(origin);
  const workersDev = /(^|\.)workers\.dev$/.test(publicUrl.hostname);
  if (workersDev) {
    const subdomain = input('CLOUDFLARE_WORKERS_SUBDOMAIN');
    if (
      runnerMode !== 'OWNER_TUNNEL' ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain) ||
      publicUrl.hostname !== `${names.worker}.${subdomain}.workers.dev`
    )
      throw new Error(
        'PUBLIC_ORIGIN must match the separate production Worker',
      );
  }
  if (
    publicUrl.port ||
    isIP(publicUrl.hostname) ||
    publicUrl.hostname.length > 253 ||
    publicUrl.hostname.split('.').length < 2 ||
    !publicUrl.hostname
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error(
      'PUBLIC_ORIGIN must use a production custom-domain hostname',
    );
  const organizationOrigin = httpsOrigin('PRODUCTION_ORG_PUBLIC_ORIGIN');
  // The organization is hosted in this worker; ORG_SERVICE delegation is unnecessary.
  if (origin !== organizationOrigin)
    throw new Error(
      'Production organization origin must match PUBLIC_ORIGIN for the direct ORG_DB deployment',
    );
  const organizationName = input('PRODUCTION_ORG_NAME');
  if (
    organizationName.length > 39 ||
    !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(organizationName)
  )
    throw new Error('Invalid PRODUCTION_ORG_NAME');
  const provider = input('PRODUCTION_AI_PROVIDER');
  if (!['cloudflare', 'callmissed'].includes(provider))
    throw new Error('Invalid PRODUCTION_AI_PROVIDER');
  const model = input('PRODUCTION_AI_MODEL');
  if (model.length > 200 || !/^[A-Za-z0-9@/._:-]+$/.test(model))
    throw new Error('Invalid PRODUCTION_AI_MODEL');
  const runnerEndpoint = httpsOrigin('PRODUCTION_RUNNER_ENDPOINT');
  if (runnerEndpoint === origin)
    throw new Error('Production runner must use a separate isolated endpoint');
  const image = input('PRODUCTION_RUNNER_IMAGE');
  if (
    !(
      runnerMode === 'OWNER_TUNNEL'
        ? /^docker-local@sha256:[a-f0-9]{64}$/
        : /^registry\.cloudflare\.com\/[A-Za-z0-9/_-]+@sha256:[a-f0-9]{64}$/
    ).test(image)
  )
    throw new Error('PRODUCTION_RUNNER_IMAGE must be digest pinned');
  if (
    runnerMode === 'OWNER_TUNNEL' &&
    !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/.test(
      runnerEndpoint,
    )
  )
    throw new Error(
      'OWNER_TUNNEL requires an HTTPS trycloudflare runner origin',
    );
  const config = {
    name: names.worker,
    main: sourcePath('src/index.ts'),
    compatibility_date: '2026-08-01',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: workersDev,
    preview_urls: false,
    ...(workersDev
      ? {}
      : { routes: [{ pattern: publicUrl.hostname, custom_domain: true }] }),
    assets: {
      directory: sourcePath('public'),
      binding: 'ASSETS',
      run_worker_first: ['/api/*', '/health', '/webhooks/*', '/auth/github/*'],
    },
    vars: {
      ENVIRONMENT: 'production',
      DEMO_MODE: 'false',
      PREVIEW_TESTING: 'false',
      PUBLIC_ORIGIN: origin,
      ORG_PUBLIC_ORIGIN: organizationOrigin,
      ORG_NAME: organizationName,
      AI_PROVIDER: provider,
      ...(provider === 'cloudflare'
        ? { AI_MODEL: model }
        : { CALLMISSED_MODEL: model }),
      RUNNER_ENABLED: 'true',
      RUNNER_ENDPOINT: runnerEndpoint,
      RUNNER_IMAGE_URI: image,
    },
    observability: { enabled: true },
    workflows: [
      {
        binding: 'EVALUATOR',
        name: names.evaluator,
        class_name: 'EvaluationWorkflow',
      },
      {
        binding: 'ORG_EVALUATOR',
        name: names.organizationEvaluator,
        class_name: 'OrganizationEvaluationWorkflow',
      },
    ],
    services: [],
    d1_databases: [
      {
        binding: 'DB',
        database_name: names.database,
        database_id: database,
        migrations_dir: sourcePath('migrations'),
      },
      {
        binding: 'ORG_DB',
        database_name: names.organizationDatabase,
        database_id: organizationDatabase,
        migrations_dir: sourcePath('migrations'),
      },
    ],
    ...(bucket
      ? { r2_buckets: [{ binding: 'ARTIFACTS', bucket_name: bucket }] }
      : {}),
    kv_namespaces: [{ binding: 'ARTIFACT_KV', id: artifactKv }],
    ai: { binding: 'AI' },
    triggers: { crons: ['*/2 * * * *'] },
  };
  if (workspace) {
    const forbiddenNames = new Set(
      nonproduction.flatMap((c) => [
        c.name,
        ...(c.workflows ?? []).map((w) => w.name),
        ...(c.d1_databases ?? []).map((d) => d.database_name),
      ]),
    );
    if (Object.values(names).some((name) => forbiddenNames.has(name)))
      throw new Error('Workspace resource name collision');
  }
  return config;
}
export async function writeProductionConfig(
  env = process.env,
  { root = process.cwd() } = {},
) {
  const config = await buildProductionConfig(env, { root });
  const output =
    env.PRODUCTION_CONFIG_PATH ??
    (env.PRODUCTION_WORKSPACE_NAME
      ? `.wrangler/workspaces/${env.PRODUCTION_WORKSPACE_NAME}/config.json`
      : '.wrangler/production.json');
  const path = resolve(root, output);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return path;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await writeProductionConfig();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
