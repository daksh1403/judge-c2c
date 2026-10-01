import { mkdir, writeFile } from 'node:fs/promises';
const database = process.env.PRODUCTION_DATABASE_ID,
  bucket = process.env.PRODUCTION_ARTIFACT_BUCKET,
  origin = process.env.PUBLIC_ORIGIN;
if (!database || !/^[a-f0-9-]{36}$/.test(database))
  throw new Error('Set a separate PRODUCTION_DATABASE_ID');
if (!bucket || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket))
  throw new Error('Set PRODUCTION_ARTIFACT_BUCKET');
if (!origin || new URL(origin).protocol !== 'https:')
  throw new Error('Set HTTPS PUBLIC_ORIGIN');
await mkdir('.wrangler', { recursive: true });
await writeFile(
  '.wrangler/production.json',
  JSON.stringify(
    {
      name: 'judge-c2c',
      main: '../src/index.ts',
      compatibility_date: '2026-08-01',
      compatibility_flags: ['nodejs_compat'],
      assets: {
        directory: '../public',
        binding: 'ASSETS',
        run_worker_first: ['/api/*', '/health', '/webhooks/*'],
      },
      vars: {
        ENVIRONMENT: 'production',
        DEMO_MODE: 'false',
        PUBLIC_ORIGIN: origin,
      },
      observability: { enabled: true },
      workflows: [
        {
          binding: 'EVALUATOR',
          name: 'judge-c2c-evaluator',
          class_name: 'EvaluationWorkflow',
        },
      ],
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'judge-c2c-production',
          database_id: database,
          migrations_dir: '../migrations',
        },
      ],
      r2_buckets: [{ binding: 'ARTIFACTS', bucket_name: bucket }],
      triggers: { crons: ['*/2 * * * *'] },
    },
    null,
    2,
  ),
);
