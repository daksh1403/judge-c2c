import { build } from 'esbuild';
import { spawn } from 'node:child_process';
await build({
  entryPoints: ['runner/execution-profile-rehearsal.ts'],
  outfile: '.wrangler/execution-profile-rehearsal.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node24',
});
const child = spawn(
  process.execPath,
  ['.wrangler/execution-profile-rehearsal.mjs'],
  { stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 1));
