// Keys are read from a private local file and passed to Wrangler on stdin only.
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
export async function validateAIKeys(path) {
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw Error('AI key file must be private (chmod 600).');
  const values = JSON.parse(await readFile(path, 'utf8'));
  for (const name of ['GEMINI_API_KEY', 'GROQ_API_KEY'])
    if (
      typeof values[name] !== 'string' ||
      values[name].length < 16 ||
      values[name].length > 1000 ||
      /\s/.test(values[name])
    )
      throw Error('Missing or malformed ' + name + '.');
  return {
    GEMINI_API_KEY: values.GEMINI_API_KEY,
    GROQ_API_KEY: values.GROQ_API_KEY,
  };
}
async function main() {
  const [file, configPath] = process.argv.slice(2);
  if (!file || !configPath)
    throw Error(
      'Usage: node scripts/configure-ai.mjs PRIVATE_KEYS_JSON PRIVATE_WORKER_CONFIG',
    );
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (
    config.vars?.ENVIRONMENT !== 'production' ||
    config.vars?.PREVIEW_TESTING !== 'false' ||
    config.vars?.DEMO_MODE !== 'false' ||
    config.preview_urls !== false
  )
    throw Error(
      'Only an explicit production/workspace configuration can receive these keys. Previews remain credential-free.',
    );
  const keys = await validateAIKeys(file);
  const child = spawn(
    'npx',
    ['wrangler', 'secret', 'bulk', '--config', resolve(configPath)],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  child.stdin.end(JSON.stringify(keys));
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(Error('AI secret provisioning failed.')),
    );
  });
  console.log(
    'Gemini and Groq secrets installed. Provider/model selection and live diagnostics remain required.',
  );
}
if (
  process.argv[1] &&
  import.meta.url === new URL('file://' + resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
