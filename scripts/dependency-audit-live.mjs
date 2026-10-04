import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
await build({
  entryPoints: ['src/dependency-audit.ts'],
  outfile: '.wrangler/dependency-audit-live.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
});
const { dependencyAudit } =
  await import('../.wrangler/dependency-audit-live.mjs');
const input = (version) => ({
  manifest: JSON.stringify({ dependencies: { lodash: version } }),
  lock: JSON.stringify({
    lockfileVersion: 3,
    packages: { '': {}, 'node_modules/lodash': { version } },
  }),
});
const began = Date.now();
const evidence = await dependencyAudit(input('4.17.20'), input('4.17.21'));
const result = {
  at: new Date().toISOString(),
  profile: 'LIVE_OSV_READ_ONLY',
  scope:
    'Exact declared npm inventory/advisory delta only; not exploitability or comprehensive source security.',
  durationMs: Date.now() - began,
  evidence,
};
await writeFile(
  'docs/qa/current-live-dependency-audit.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    profile: result.profile,
    durationMs: result.durationMs,
    evidenceCount: evidence.length,
    unverified: evidence.some((e) => e.status === 'UNVERIFIED'),
  }),
);
if (evidence.some((e) => e.status === 'UNVERIFIED')) process.exitCode = 1;
