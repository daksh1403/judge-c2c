import { readFile, writeFile } from 'node:fs/promises';
import { canonical, digest } from '../src/domain';
import { docker, evaluateDocker } from '../src/local-docker';
import { cacheableResult } from '../src/execution-cache';
import { validateRunnerResult, type RunnerRequest } from '../src/runner';

const inspect = await docker([
  'image',
  'inspect',
  'judge-c2c-runner-dependencies',
  '--format',
  '{{.Id}}',
]);
if (inspect.exitCode) throw Error('DEPENDENCY_IMAGE_UNAVAILABLE');
const image = inspect.stdout.trim();
const manifest = JSON.parse(await readFile('runner/package.json', 'utf8'));
manifest.packageManager = 'npm@11.19.0';
manifest.scripts = {
  preinstall:
    "node -e \"require('fs').writeFileSync('lifecycle-ran','unsafe')\"",
};
const lock = await readFile('runner/package-lock.json', 'utf8');
const source = `import http from 'node:http';http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end('{"ok":true}');}).listen(9000,'0.0.0.0');`;
const evidence = [];
for (const label of [
  'success',
  'setup-reuse-fresh-benchmark',
  'cache-miss-failure',
  'lock-rejected',
] as const) {
  const parsed = JSON.parse(lock);
  if (label === 'cache-miss-failure')
    parsed.packages['node_modules/eslint'].integrity =
      'sha512-' + 'A'.repeat(86) + '==';
  const lockText =
    label === 'cache-miss-failure' ? JSON.stringify(parsed) : lock;
  const request: RunnerRequest = {
    runId: await digest('dependency-fixture-' + label),
    commit: '1'.repeat(40),
    contractHash: await digest(label),
    timeoutSeconds: 80,
    memoryMiB: 256,
    policy: {
      version: 'node-http-v1',
      image: 'docker-local@' + image,
      entrypoint: 'server.mjs',
      dependencies: {
        mode: 'NPM_OFFLINE_V1',
        npmVersion: '11.19.0',
        lockHash:
          label === 'lock-rejected' ? '0'.repeat(64) : await digest(lockText),
      },
      commands: [
        {
          id: 'installed-module',
          kind: 'test',
          argv: [
            'node',
            '-e',
            "require('eslint');const started=Date.now();setTimeout(()=>console.log(JSON.stringify({started,finished:Date.now()})),1000)",
          ],
        },
        {
          id: 'scripts-disabled',
          kind: 'security',
          argv: [
            'node',
            '-e',
            "if(require('node:fs').existsSync('lifecycle-ran'))process.exit(1);const started=Date.now();setTimeout(()=>console.log(JSON.stringify({started,finished:Date.now()})),1000)",
          ],
        },
      ],
      cases: [
        {
          id: 'http',
          path: '/',
          method: 'GET',
          expectedStatus: 200,
          expectedBody: { ok: true },
        },
      ],
      benchmarks: [
        {
          id: 'latency',
          path: '/',
          method: 'GET',
          expectedStatus: 200,
          expectedBody: { ok: true },
          warmup: 1,
          samples: 10,
          maxP95Ms: 5000,
        },
      ],
    },
    files: [
      { path: 'package.json', text: JSON.stringify(manifest) },
      { path: 'package-lock.json', text: lockText },
      {
        path: '.npmrc',
        text: 'ignore-scripts=false\nregistry=http://169.254.169.254\n',
      },
      { path: 'server.mjs', text: source },
    ],
  };
  const result = validateRunnerResult(
    await evaluateDocker(request, image),
    request,
    await digest(canonical(request)),
  );
  const failed = label === 'cache-miss-failure' || label === 'lock-rejected';
  if (!failed && result.checks.some((c) => c.status !== 'PASS'))
    throw Error('DEPENDENCY_SUCCESS_FAILED ' + canonical(result));
  if (!failed) {
    if (
      !result.metrics?.startupMs ||
      result.metrics.tools?.npm !== '11.19.0' ||
      result.metrics.resources.length !== 3 ||
      result.metrics.resources.some(
        (s) => s.memoryBytes === 0 || s.cpuUsageUsec === 0,
      )
    )
      throw Error('ACTUAL_METRICS_UNAVAILABLE');
    const intervals = result.checks
      .filter((c) => ['installed-module', 'scripts-disabled'].includes(c.id))
      .map((c) => JSON.parse(c.stdout));
    if (
      Math.max(...intervals.map((x) => x.started)) >=
      Math.min(...intervals.map((x) => x.finished))
    )
      throw Error('INDEPENDENT_CHECKS_DID_NOT_OVERLAP');
  }
  if (failed && result.checks.some((c) => c.status === 'PASS'))
    throw Error('DEPENDENCY_FALSE_PASS');
  if (
    label === 'cache-miss-failure' &&
    result.checks.find((c) => c.id === 'dependency-preparation')?.status !==
      'FAIL'
  )
    throw Error('INSTALL_FAILURE_NOT_RECORDED');
  if (cacheableResult(result, canonical(result), request.timeoutSeconds))
    throw Error('HISTORICAL_BENCHMARK_CACHE_ALLOWED');
  evidence.push({ label, requestHash: result.requestHash, result });
  console.log(
    label,
    result.checks.map((c) => `${c.id}:${c.status}`).join(', '),
  );
}
const remaining = await docker([
  'ps',
  '--all',
  '--quiet',
  '--filter',
  'label=judge-c2c.local-runner=1',
]);
if (remaining.exitCode || remaining.stdout.trim())
  throw Error('DEPENDENCY_GUEST_LEAK');
await writeFile(
  'docs/qa/dependency-docker-evidence.json',
  JSON.stringify(
    {
      synthetic: true,
      scope:
        'Local Docker, immutable prepared npm catalogue only. Cloudflare execution is unverified; this is not a live hackathon evaluation.',
      at: new Date().toISOString(),
      image,
      evidence,
    },
    null,
    2,
  ) + '\n',
);
