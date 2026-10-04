import { build } from 'esbuild';
import { spawn } from 'node:child_process';
await build({
  entryPoints: ['runner/smoke.ts'],
  outfile: '.wrangler/local-runner-smoke.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node24',
});
const p = spawn(process.execPath, ['.wrangler/local-runner-smoke.mjs'], {
  stdio: 'inherit',
});
p.on('exit', (code) => process.exit(code ?? 1));
