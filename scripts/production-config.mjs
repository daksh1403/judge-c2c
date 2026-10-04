import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse } from 'jsonc-parser';
import { isIP } from 'node:net';

// Read identifiers only to deny reuse; never inherit review bindings or values.
const existing = parse(await readFile('wrangler.jsonc', 'utf8'));
const nonproduction = [
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
  nonproduction.flatMap((c) => (c.r2_buckets ?? []).map((b) => b.bucket_name)),
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
  const value = process.env[key];
  if (!value || value.trim() !== value) throw new Error(`Set ${key}`);
  return value;
};
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
const bucket = input('PRODUCTION_ARTIFACT_BUCKET');
if (
  !/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket) ||
  forbiddenBuckets.has(bucket) ||
  /(^|-)(local|review|preview|test)(-|$)/.test(bucket)
)
  throw new Error(
    'PRODUCTION_ARTIFACT_BUCKET must be a separate production bucket',
  );
const origin = httpsOrigin('PUBLIC_ORIGIN');
const publicUrl = new URL(origin);
if (
  publicUrl.port ||
  isIP(publicUrl.hostname) ||
  publicUrl.hostname.length > 253 ||
  publicUrl.hostname.split('.').length < 2 ||
  !publicUrl.hostname
    .split('.')
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
  /(^|\.)workers\.dev$/.test(publicUrl.hostname)
)
  throw new Error('PUBLIC_ORIGIN must use a production custom-domain hostname');
const organizationOrigin = httpsOrigin('PRODUCTION_ORG_PUBLIC_ORIGIN');
// The organization is hosted in this worker; ORG_SERVICE delegation is unnecessary.
if (origin !== organizationOrigin)
  throw new Error(
    'Production organization origin must match PUBLIC_ORIGIN for the direct ORG_DB deployment',
  );
const organizationName = input('PRODUCTION_ORG_NAME');
if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(organizationName))
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
  !/^registry\.cloudflare\.com\/[A-Za-z0-9/_-]+@sha256:[a-f0-9]{64}$/.test(
    image,
  )
)
  throw new Error('PRODUCTION_RUNNER_IMAGE must be digest pinned');
const config = {
  name: 'judge-c2c',
  main: '../src/index.ts',
  compatibility_date: '2026-08-01',
  compatibility_flags: ['nodejs_compat'],
  workers_dev: false,
  preview_urls: false,
  routes: [{ pattern: publicUrl.hostname, custom_domain: true }],
  assets: {
    directory: '../public',
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
      name: 'judge-c2c-evaluator',
      class_name: 'EvaluationWorkflow',
    },
    {
      binding: 'ORG_EVALUATOR',
      name: 'judge-c2c-organization-production-evaluator',
      class_name: 'OrganizationEvaluationWorkflow',
    },
  ],
  services: [],
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'judge-c2c-production',
      database_id: database,
      migrations_dir: '../migrations',
    },
    {
      binding: 'ORG_DB',
      database_name: 'judge-c2c-organization-production',
      database_id: organizationDatabase,
      migrations_dir: '../migrations',
    },
  ],
  r2_buckets: [{ binding: 'ARTIFACTS', bucket_name: bucket }],
  kv_namespaces: [{ binding: 'ARTIFACT_KV', id: artifactKv }],
  ai: { binding: 'AI' },
  triggers: { crons: ['*/2 * * * *'] },
};
await mkdir('.wrangler', { recursive: true });
await writeFile(
  '.wrangler/production.json',
  JSON.stringify(config, null, 2) + '\n',
);
