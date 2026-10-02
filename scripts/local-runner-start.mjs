import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import './local-runner-build.mjs';
await mkdir('.wrangler', { recursive: true });
try {
  await readFile('.wrangler/local-runner-key.txt');
} catch {
  await writeFile(
    '.wrangler/local-runner-key.txt',
    randomBytes(32).toString('hex') + '\n',
    { mode: 0o600 },
  );
}
const image = execFileSync(
  'docker',
  ['image', 'inspect', 'judge-c2c-runner-local:latest', '--format', '{{.Id}}'],
  { encoding: 'utf8' },
).trim();
if (!/^sha256:[a-f0-9]{64}$/.test(image))
  throw new Error('Build the trusted local runner image first.');
await writeFile('.wrangler/local-runner-image.txt', image + '\n', {
  mode: 0o600,
});
const runner = spawn(process.execPath, ['.wrangler/local-runner.mjs'], {
  stdio: 'inherit',
});
await new Promise((resolve, reject) => {
  const deadline = Date.now() + 10000;
  const poll = async () => {
    if (Date.now() > deadline) return reject(Error('Runner did not start'));
    try {
      await fetch('http://127.0.0.1:8790');
      resolve();
    } catch {
      setTimeout(poll, 100);
    }
  };
  void poll();
});
const tunnel = spawn(
  'cloudflared',
  ['tunnel', '--url', 'http://127.0.0.1:8790', '--no-autoupdate'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let found = false;
const configure = async (chunk) => {
  if (found) return;
  const endpoint = chunk
    .toString()
    .match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!endpoint) return;
  found = true;
  const config = JSON.parse(
    (await readFile('wrangler.jsonc', 'utf8')).replace(/,\s*([}\]])/g, '$1'),
  );
  const review = config.env.review;
  const deployed = { ...config, ...review };
  delete deployed.env;
  delete deployed.previews;
  delete deployed.services;
  deployed.main = '../src/index.ts';
  deployed.assets = { ...config.assets, directory: '../public' };
  deployed.d1_databases = review.d1_databases.map((d) => ({
    ...d,
    migrations_dir: '../migrations',
  }));
  deployed.vars = {
    ...review.vars,
    RUNNER_ENABLED: 'true',
    RUNNER_ENDPOINT: endpoint[0],
    RUNNER_IMAGE_URI: 'docker-local@' + image,
  };
  await writeFile(
    '.wrangler/local-runner-config.json',
    JSON.stringify(deployed, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log(
    'Authenticated development tunnel ready. Website URL is unchanged.',
  );
  console.log('To connect the existing internal host: npm run runner:connect');
};
tunnel.stdout.on('data', (c) => void configure(c));
tunnel.stderr.on('data', (c) => void configure(c));
const stop = () => {
  runner.kill('SIGTERM');
  tunnel.kill('SIGTERM');
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
runner.on('exit', () => {
  tunnel.kill('SIGTERM');
});
tunnel.on('exit', () => runner.kill('SIGTERM'));
