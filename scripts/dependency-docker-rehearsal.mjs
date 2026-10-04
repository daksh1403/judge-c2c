import { build } from 'esbuild';
import { spawn } from 'node:child_process';
await build({
  entryPoints: ['runner/dependency-rehearsal.ts'],
  outfile: '.wrangler/dependency-rehearsal.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node24',
});
const child = spawn(process.execPath, ['.wrangler/dependency-rehearsal.mjs'], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
