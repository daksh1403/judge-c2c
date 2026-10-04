import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const remote = process.argv.includes('--remote'),
  suffix = remote ? '' : '-local';
await mkdir('.wrangler', { recursive: true });
async function load(name) {
  const path = `.wrangler/organization-${name}${suffix}.txt`;
  try {
    const value = (await readFile(path, 'utf8')).trim().replace(/\\n$/, '');
    if (!/^[a-f0-9]{64}$/.test(value))
      throw new Error('INVALID_BOOTSTRAP_SECRET');
    await writeFile(path, value + '\n', { mode: 0o600 });
    return value;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const value = randomBytes(32).toString('hex');
    await writeFile(path, value + '\n', { mode: 0o600 });
    return value;
  }
}
const admin = await load('access'),
  key = await load('vault');
if (remote) {
  for (const [name, value] of [
    ['ORG_ADMIN_TOKEN', admin],
    ['ORG_VAULT_KEY', key],
  ]) {
    const result = spawnSync(
      'npx',
      ['wrangler', 'secret', 'put', name, '--env', 'review'],
      { input: value + '\n', stdio: ['pipe', 'inherit', 'inherit'] },
    );
    if (result.status !== 0)
      throw new Error('ORGANIZATION_SECRET_SETUP_FAILED');
  }
} else {
  let text = '';
  try {
    text = await readFile('.dev.vars', 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  text = text.replace(/^ORG_(ADMIN_TOKEN|VAULT_KEY)=.*\n?/gm, '');
  await writeFile(
    '.dev.vars',
    text + `\nORG_ADMIN_TOKEN=${admin}\nORG_VAULT_KEY=${key}\n`,
    { mode: 0o600 },
  );
}
console.log(
  `Organizer access code saved in .wrangler/organization-access${suffix}.txt. Vault backup is private; do not put it in git or browser code.`,
);
