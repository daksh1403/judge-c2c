import { readFile, writeFile } from 'node:fs/promises';
import { evaluateDocker } from '../src/local-docker';
import { paymentRetryPolicy } from '../src/runner-policy';
import { canonical, digest } from '../src/domain';
const image = (
    await readFile('.wrangler/local-runner-image.txt', 'utf8')
  ).trim(),
  server = await readFile('examples/payment-retry/server.mjs', 'utf8'),
  policy = {
    ...paymentRetryPolicy,
    image: 'docker-local@' + image,
    commands: [
      {
        id: 'build',
        kind: 'build' as const,
        argv: ['node', '--check', 'build-input.mjs'],
      },
    ],
  };
const result = [];
for (const scenario of [
  'baseline-build-failure',
  'submission-build-failure',
] as const) {
  const pair = [];
  for (const side of ['baseline', 'submission'] as const) {
    const failed =
      (scenario === 'baseline-build-failure') === (side === 'baseline');
    const r = await evaluateDocker(
      {
        runId: await digest(scenario + side),
        commit: (side === 'baseline' ? 'a' : 'b').repeat(40),
        contractHash: await digest(canonical(policy)),
        timeoutSeconds: 60,
        memoryMiB: 256,
        policy,
        files: [
          { path: 'server.mjs', text: server },
          {
            path: 'build-input.mjs',
            text: failed ? 'const = ;' : 'export const ok = true;',
          },
        ],
      },
      image,
    );
    const build = r.checks.find((c) => c.id === 'build');
    if (
      build?.status !== (failed ? 'FAIL' : 'PASS') ||
      r.checks
        .filter((c) => c.kind === 'acceptance')
        .some((c) => c.status !== 'PASS')
    )
      throw Error('BUILD_FAILURE_NOT_ISOLATED');
    pair.push({ side, result: r });
  }
  result.push({ scenario, pair });
}
await writeFile(
  'docs/qa/current-build-failures.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      mode: 'REAL_DOCKER_BOUNDED_SYNTHETIC_BUILD_FAILURES',
      scope:
        'Pinned image; independent failed build command on baseline or head; trusted acceptance evidence is preserved. No production or full TypeScript compiler claim.',
      result,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    result.map((x) => ({
      scenario: x.scenario,
      checks: x.pair.map((p) => ({
        side: p.side,
        build: p.result.checks.find((c) => c.id === 'build')?.status,
      })),
    })),
  ),
);
