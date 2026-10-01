import { mkdir, writeFile } from 'node:fs/promises';
const pr = process.env.PR_NUMBER;
if (!pr || !/^\d+$/.test(pr))
  throw new Error('PR_NUMBER must be a positive integer');
await mkdir('.wrangler', { recursive: true });
// Independent allowlist, no spreading the production configuration or bindings.
await writeFile(
  '.wrangler/pr-review.json',
  JSON.stringify(
    {
      name: `judge-c2c-pr-${pr}`,
      main: '../src/index.ts',
      compatibility_date: '2026-08-01',
      compatibility_flags: ['nodejs_compat'],
      assets: {
        directory: '../public',
        binding: 'ASSETS',
        run_worker_first: ['/api/*', '/health', '/webhooks/*'],
      },
      vars: { ENVIRONMENT: 'review', DEMO_MODE: 'true' },
      observability: { enabled: true },
      workflows: [
        {
          binding: 'EVALUATOR',
          name: `judge-c2c-pr-${pr}-evaluator`,
          class_name: 'EvaluationWorkflow',
        },
      ],
    },
    null,
    2,
  ),
);
