import { createRunnerServer } from '../src/local-runner-server';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { canonical, digest } from '../src/domain';
import {
  runnerSignature,
  requestMessage,
  responseMessage,
} from '../src/runner-tunnel';
import { verifyWebhook } from '../src/security';
import {
  evaluateDocker,
  docker,
  cleanupDocker,
  reapOrphanContainers,
} from '../src/local-docker';
const key = (await readFile('.wrangler/local-runner-key.txt', 'utf8')).trim();
const image = (
  await readFile('.wrangler/local-runner-image.txt', 'utf8')
).trim();
if (!/^[a-f0-9]{64}$/.test(key) || !/^sha256:[a-f0-9]{64}$/.test(image))
  throw new Error('RUNNER_CONFIGURATION_INVALID');
const info = await docker(['info', '--format', '{{json .SecurityOptions}}']);
if (info.exitCode !== 0 || !info.stdout.includes('seccomp'))
  throw new Error('Docker default seccomp is required.');
const inspected = await docker([
  'image',
  'inspect',
  image,
  '--format',
  '{{.Id}}',
]);
if (inspected.exitCode !== 0 || inspected.stdout.trim() !== image)
  throw new Error('RUNNER_IMAGE_NOT_AVAILABLE');
await reapOrphanContainers();
const server = createRunnerServer(key, (body) => evaluateDocker(body, image));
server.requestTimeout = 10000;
server.headersTimeout = 5000;
server.maxConnections = 16;
server.listen(8790, '127.0.0.1', () =>
  console.log(
    'Development Docker runner listening on 127.0.0.1:8790; authenticated jobs only.',
  ),
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.close();
    void cleanupDocker().then(
      () => process.exit(0),
      () => {
        console.error(
          'Runner cleanup failed; inspect Judge-C2C containers before restarting.',
        );
        process.exit(1);
      },
    );
  });
