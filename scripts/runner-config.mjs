import { readFile, writeFile, mkdir } from 'node:fs/promises';
if (process.env.JUDGE_RUNNER_ENABLE !== 'true')
  throw new Error(
    'Runner deployment is disabled. Explicit operator enablement is required.',
  );
const image = process.env.JUDGE_RUNNER_IMAGE;
if (
  !/^registry\.cloudflare\.com\/[A-Za-z0-9/_-]+@sha256:[a-f0-9]{64}$/.test(
    image ?? '',
  )
)
  throw new Error(
    'A digest-pinned image in the account managed registry is required.',
  );
const config = JSON.parse(
  (await readFile('wrangler.jsonc', 'utf8')).replace(/,\s*([}\]])/g, '$1'),
);
const review = config.env.review;
const deployed = { ...config, ...review };
delete deployed.env;
delete deployed.previews;
deployed.main = '../src/index.ts';
deployed.assets = { ...config.assets, directory: '../public' };
deployed.vars = {
  ...review.vars,
  RUNNER_ENABLED: 'true',
  RUNNER_IMAGE_URI: image,
};
deployed.d1_databases = review.d1_databases.map((d) => ({
  ...d,
  migrations_dir: '../migrations',
}));
deployed.containers = [
  {
    class_name: 'IsolatedRunner',
    scheduling_policy: 'durable_object',
    max_instances: 4,
    images: { node: { image } },
  },
];
deployed.durable_objects = {
  bindings: [{ name: 'RUNNER', class_name: 'IsolatedRunner' }],
};
deployed.exports = {
  IsolatedRunner: { type: 'durable-object', storage: 'sqlite' },
};
await mkdir('.wrangler', { recursive: true });
await writeFile(
  '.wrangler/runner.json',
  JSON.stringify(deployed, null, 2) + '\n',
);
console.log(
  'Prepared internal-host runner configuration. No new public route. Deployment has not occurred.',
);
