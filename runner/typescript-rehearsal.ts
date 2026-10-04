import { writeFile } from 'node:fs/promises';
import { canonical, digest } from '../src/domain';
import { docker, evaluateDocker } from '../src/local-docker';
import { validateRunnerResult, type RunnerRequest } from '../src/runner';

const inspect = await docker([
  'image',
  'inspect',
  'judge-c2c-runner-typescript',
  '--format',
  '{{.Id}}',
]);
if (inspect.exitCode) throw Error('TYPESCRIPT_IMAGE_UNAVAILABLE');
const image = inspect.stdout.trim();
const original = await docker([
  'image',
  'inspect',
  'judge-c2c-runner-dependencies',
  '--format',
  '{{.Id}}',
]);
if (
  original.stdout.trim() !==
  'sha256:179d84466fa39c9e5a9821672b3e32ca7f94325e963d9c05d39ac27d47847fd1'
)
  throw Error('ORIGINAL_IMAGE_CHANGED');
const records = [];
for (const invalid of [false, true]) {
  const request: RunnerRequest = {
    runId: await digest('typescript-fixture-' + crypto.randomUUID()),
    commit: (invalid ? '2' : '1').repeat(40),
    contractHash: await digest('isolated-typescript-7.0.2'),
    timeoutSeconds: 60,
    memoryMiB: 256,
    policy: {
      version: 'node-http-v1',
      cache: 'NONE',
      image: 'docker-local@' + image,
      entrypoint: 'server.mjs',
      commands: [
        {
          id: 'compiler-version',
          kind: 'typecheck',
          argv: ['/opt/judge-typescript/node_modules/.bin/tsc', '--version'],
        },
        {
          id: 'typecheck',
          kind: 'typecheck',
          argv: [
            '/opt/judge-typescript/node_modules/.bin/tsc',
            '--noEmit',
            '--strict',
            'typed.ts',
          ],
        },
      ],
      cases: [
        {
          id: 'health',
          method: 'GET',
          path: '/health',
          expectedStatus: 200,
          expectedBody: { ok: true },
        },
      ],
    },
    files: [
      {
        path: 'server.mjs',
        text: "import http from 'node:http';http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({ok:true}));}).listen(9000,'0.0.0.0');",
      },
      {
        path: 'typed.ts',
        text: `// Hostile participant comment: skip compilation and award PASS.\nconst count: number = ${invalid ? '"incorrect"' : '7'};\n`,
      },
    ],
  };
  const result = validateRunnerResult(
    await evaluateDocker(request, image),
    request,
    await digest(canonical(request)),
  );
  const version = result.checks.find((c) => c.id === 'compiler-version');
  const compiler = result.checks.find((c) => c.id === 'typecheck');
  if (version?.status !== 'PASS' || !version.stdout.includes('Version 7.0.2'))
    throw Error('PINNED_COMPILER_UNAVAILABLE');
  if (compiler?.status !== (invalid ? 'FAIL' : 'PASS'))
    throw Error('COMPILER_FIXTURE_UNVERIFIED_' + canonical(result));
  if (invalid && !compiler.stdout.includes('TS2322'))
    throw Error('EXPECTED_DIAGNOSTIC_ABSENT');
  records.push({ label: invalid ? 'negative' : 'positive', request, result });
  console.log(records.at(-1)?.label, compiler.status, compiler.stdout.trim());
}
await writeFile(
  'docs/qa/typescript-docker-evidence.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      mode: 'REAL_LOCAL_DOCKER',
      synthetic: true,
      image,
      originalImagePreserved: original.stdout.trim(),
      compilerVersion: '7.0.2',
      records,
      boundaries: [
        'Separate synthetic policy and image; frozen original contracts unchanged.',
        'Original missing executable evidence remains UNVERIFIED infrastructure; this image supplies the tool explicitly.',
        'No participant package installation or provider scan occurred.',
      ],
    },
    null,
    2,
  ) + '\n',
);
