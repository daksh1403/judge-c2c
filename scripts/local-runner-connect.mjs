import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const key = await readFile('.wrangler/local-runner-key.txt', 'utf8');
const config = JSON.parse(
  await readFile('.wrangler/local-runner-config.json', 'utf8'),
);
if (
  config.name !== 'judge-c2c-review' ||
  config.vars.RUNNER_ENABLED !== 'true' ||
  !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(
    config.vars.RUNNER_ENDPOINT,
  )
)
  throw new Error('Invalid development runner configuration');
function run(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('npx', ['wrangler', ...args], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    p.stdin.end(input);
    p.on('error', reject);
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(Error('Deployment failed')),
    );
  });
}
await run(['secret', 'put', 'RUNNER_TUNNEL_KEY', '--env', 'review'], key);
await run(['deploy', '--config', '.wrangler/local-runner-config.json']);
