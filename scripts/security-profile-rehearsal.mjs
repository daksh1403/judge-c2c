import { build } from 'esbuild';
import { spawn } from 'node:child_process';
await build({
  entryPoints: ['runner/security-profile-rehearsal.ts'],
  outfile: '.wrangler/security-profile-rehearsal.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node24',
});
const child = spawn(
  process.execPath,
  ['.wrangler/security-profile-rehearsal.mjs'],
  { stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 1));
