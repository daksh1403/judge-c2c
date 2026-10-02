import { build } from 'esbuild';
await build({
  entryPoints: ['runner/local.ts'],
  outfile: '.wrangler/local-runner.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node24',
});
