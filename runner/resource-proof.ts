import { readFile, writeFile } from 'node:fs/promises';
import { evaluateDocker } from '../src/local-docker';
import { paymentRetryPolicy } from '../src/runner-policy';
import { digest, canonical } from '../src/domain';
const image = (
  await readFile('.wrangler/local-runner-image.txt', 'utf8')
).trim();
const policy = {
  ...paymentRetryPolicy,
  image: 'docker-local@' + image,
  commands: [
    {
      id: 'memory-exhaustion',
      kind: 'test' as const,
      argv: [
        'node',
        '-e',
        'const a=[];for(let i=0;i<600;i++)a.push(Buffer.alloc(1024*1024,1));',
      ],
    },
    {
      id: 'disk-exhaustion',
      kind: 'test' as const,
      argv: [
        'node',
        '-e',
        "const fs=require('node:fs');for(let i=0;i<20;i++)fs.writeFileSync('/tmp/fill'+i,Buffer.alloc(8*1024*1024,1));",
      ],
    },
    {
      id: 'after-resource-failures',
      kind: 'build' as const,
      argv: ['node', '--check', 'server.mjs'],
    },
  ],
};
const result = await evaluateDocker(
  {
    runId: await digest('bounded-resource-proof'),
    commit: 'a'.repeat(40),
    contractHash: await digest(canonical(policy)),
    timeoutSeconds: 60,
    memoryMiB: 256,
    policy,
    files: [
      {
        path: 'server.mjs',
        text: await readFile('examples/payment-retry/server.mjs', 'utf8'),
      },
    ],
  },
  image,
);
const checks = Object.fromEntries(result.checks.map((c) => [c.id, c]));
if (
  checks['memory-exhaustion']?.status === 'PASS' ||
  checks['disk-exhaustion']?.status === 'PASS' ||
  checks['after-resource-failures']?.status !== 'PASS' ||
  result.checks
    .filter((c) => c.kind === 'acceptance')
    .some((c) => c.status !== 'PASS')
)
  throw Error('RESOURCE_FAILURE_ISOLATION_NOT_PROVEN');
await writeFile(
  'docs/qa/current-resource-exhaustion.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      mode: 'REAL_DOCKER_ISOLATED_SYNTHETIC_RUNTIME',
      limits: { memoryMiB: 256, tmpfsMiB: 64, perFileMiB: 16 },
      result,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    result.checks.map(({ id, status, exitCode }) => ({ id, status, exitCode })),
  ),
);
