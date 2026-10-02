import {
  containerArguments,
  docker,
  removeContainer,
} from '../src/local-docker';
import { readFile, writeFile } from 'node:fs/promises';
import { canonical, digest } from '../src/domain';
import { tunnelEvaluate } from '../src/runner-tunnel';
import { validateRunnerResult, type RunnerRequest } from '../src/runner';
import { paymentRetryPolicy } from '../src/runner-policy';
import type { Env } from '../src/env';
const config = JSON.parse(
  await readFile('.wrangler/local-runner-config.json', 'utf8'),
);
const key = (await readFile('.wrangler/local-runner-key.txt', 'utf8')).trim();
const env = { ...config.vars, RUNNER_TUNNEL_KEY: key } as Env;
const policy = { ...paymentRetryPolicy, image: config.vars.RUNNER_IMAGE_URI };
const source = await readFile('examples/payment-retry/server.mjs', 'utf8');
const image = policy.image.replace('docker-local@', '');
const probeName = 'judge-c2c-' + crypto.randomUUID();
try {
  const created = await docker(containerArguments(probeName, image));
  if (created.exitCode !== 0) throw new Error('SECURITY_PROBE_CREATE_FAILED');
  await docker(['start', probeName]);
  const inspect = await docker(
    ['inspect', probeName, '--format', '{{json .HostConfig}}'],
    undefined,
    10000,
    16000,
  );
  const settings = JSON.parse(inspect.stdout);
  if (
    settings.NetworkMode !== 'none' ||
    !settings.ReadonlyRootfs ||
    settings.Memory !== 256 * 1024 * 1024 ||
    settings.MemorySwap !== settings.Memory ||
    settings.PidsLimit !== 64 ||
    settings.Binds?.length ||
    !settings.CapDrop.includes('ALL')
  )
    throw new Error('SECURITY_CONFIG_MISMATCH');
  const probe = await docker([
    'exec',
    probeName,
    'node',
    '-e',
    `(async()=>{const fs=require('node:fs');let rootWritable=false,network=false;try{fs.writeFileSync('/judge-probe','x');rootWritable=true;}catch{}try{await fetch('https://example.com',{signal:AbortSignal.timeout(1000)});network=true;}catch{}const status=fs.readFileSync('/proc/self/status','utf8');console.log(JSON.stringify({uid:process.getuid(),rootWritable,network,seccomp:status.includes('Seccomp:\t2'),caps:status.includes('CapEff:\t0000000000000000')}));})();`,
  ]);
  const actual = JSON.parse(probe.stdout);
  if (
    actual.uid !== 65534 ||
    actual.rootWritable ||
    actual.network ||
    !actual.seccomp ||
    !actual.caps
  )
    throw new Error('SECURITY_PROBE_FAILED');
  console.log(
    'Docker safety probe passed: nonroot, read-only root, seccomp, no capabilities or external network, bounded memory/PIDs.',
  );
} finally {
  await removeContainer(probeName);
}
const checks = [];
for (const [label, files] of [
  ['baseline', []],
  ['submission', [{ path: 'server.mjs', text: source }]],
] as const) {
  const request: RunnerRequest = {
    runId: await digest(crypto.randomUUID()),
    commit: (label === 'baseline' ? '0' : '1').repeat(40),
    contractHash: await digest(canonical(policy)),
    policy,
    timeoutSeconds: 60,
    memoryMiB: 256,
    files: [...files],
  };
  const result = validateRunnerResult(
    await tunnelEvaluate(env, request),
    request,
    await digest(canonical(request)),
  );
  console.log(
    label,
    JSON.stringify(
      result.checks.map((c) => ({
        id: c.id,
        status: c.status,
        detail: c.detail,
        stderr: c.stderr,
      })),
    ),
  );
  const cases = result.checks.filter((c) => c.kind === 'acceptance');
  if (cases.some((c) => c.status !== (label === 'baseline' ? 'FAIL' : 'PASS')))
    throw new Error('TRUSTED_SMOKE_FAILED');
  checks.push({ label, result });
}
await writeFile(
  '.wrangler/local-runner-smoke.json',
  JSON.stringify(
    { synthetic: true, at: new Date().toISOString(), checks },
    null,
    2,
  ) + '\n',
  { mode: 0o600 },
);
console.log(
  'Authenticated tunnel smoke passed: absent baseline FAIL → trusted reference PASS. Synthetic fixture only.',
);
