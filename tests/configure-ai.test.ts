import { expect, it } from 'vitest';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error operational script is imported directly to validate secret handling
import { validateAIKeys } from '../scripts/configure-ai.mjs';
it('requires private files and strips unrelated credentials from AI secret provisioning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'judge-ai-keys-'));
  const file = join(dir, 'keys.json');
  try {
    await writeFile(
      file,
      JSON.stringify({
        GEMINI_API_KEY: 'synthetic-gemini-key',
        GROQ_API_KEY: 'synthetic-groq-key',
        GITHUB_TOKEN: 'must-not-provision',
      }),
      { mode: 0o600 },
    );
    expect(await validateAIKeys(file)).toEqual({
      GEMINI_API_KEY: 'synthetic-gemini-key',
      GROQ_API_KEY: 'synthetic-groq-key',
    });
    await chmod(file, 0o644);
    await expect(validateAIKeys(file)).rejects.toThrow('private');
    await chmod(file, 0o600);
    await writeFile(
      file,
      JSON.stringify({ GEMINI_API_KEY: 'synthetic-gemini-key' }),
    );
    await expect(validateAIKeys(file)).rejects.toThrow('GROQ_API_KEY');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
