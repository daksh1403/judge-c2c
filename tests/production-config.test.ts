import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const inputs = {
  PRODUCTION_DATABASE_ID: '11111111-1111-1111-1111-111111111111',
  PRODUCTION_ORG_DATABASE_ID: '22222222-2222-2222-2222-222222222222',
  PRODUCTION_ARTIFACT_KV_ID: '3'.repeat(32),
  PRODUCTION_ARTIFACT_BUCKET: 'judge-production-artifacts',
  PUBLIC_ORIGIN: 'https://judge.example.org',
  PRODUCTION_ORG_PUBLIC_ORIGIN: 'https://judge.example.org',
  PRODUCTION_ORG_NAME: 'Example-Organization',
  PRODUCTION_AI_PROVIDER: 'cloudflare',
  PRODUCTION_AI_MODEL: '@cf/meta/model',
  PRODUCTION_RUNNER_ENDPOINT: 'https://runner.example.org',
  PRODUCTION_RUNNER_IMAGE:
    'registry.cloudflare.com/account/runner@sha256:' + 'a'.repeat(64),
};
function generate(overrides: Record<string, string | undefined> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'judge-production-config-'));
  try {
    copyFileSync('wrangler.jsonc', join(directory, 'wrangler.jsonc'));
    const env = {
      PATH: process.env.PATH,
      ...inputs,
      ...overrides,
      ORG_ADMIN_TOKEN: 'must-never-copy-secret',
      ORG_REVIEW_ORIGINS: 'https://review.example.org',
    };
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/production-config.mjs')],
      { cwd: directory, env, encoding: 'utf8' },
    );
    const path = join(directory, '.wrangler/production.json');
    return {
      status: result.status,
      stderr: result.stderr,
      config: existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
describe('production prerequisites and isolation', () => {
  it('requires every explicit prerequisite before writing configuration', () => {
    for (const key of Object.keys(inputs)) {
      const result = generate({ [key]: undefined });
      expect(result.status, key).not.toBe(0);
      expect(result.config, key).toBeNull();
    }
  });
  it('refuses review resources, shared databases and unsafe endpoints/images', () => {
    for (const override of [
      { PRODUCTION_DATABASE_ID: 'cbbc7d68-2fef-40c6-be53-511ffb0d720c' },
      { PRODUCTION_ORG_DATABASE_ID: '35f5053d-1fa5-49a7-89b9-4751e1c7a895' },
      { PRODUCTION_ORG_DATABASE_ID: inputs.PRODUCTION_DATABASE_ID },
      { PRODUCTION_ARTIFACT_KV_ID: '2bfcf7ac70ba405e906f7d3e7c161868' },
      { PRODUCTION_ARTIFACT_BUCKET: 'judge-review-artifacts' },
      {
        PUBLIC_ORIGIN:
          'https://feat-evaluation-completeness-judge-c2c.dakshx.workers.dev',
      },
      { PRODUCTION_RUNNER_ENDPOINT: 'http://runner.example.org' },
      {
        PRODUCTION_RUNNER_ENDPOINT: 'https://user:password@runner.example.org',
      },
      { PRODUCTION_RUNNER_ENDPOINT: inputs.PUBLIC_ORIGIN },
      { PRODUCTION_RUNNER_IMAGE: 'runner:latest' },
      { PRODUCTION_AI_PROVIDER: 'unknown' },
    ]) {
      const result = generate(override);
      expect(result.status).not.toBe(0);
      expect(result.config).toBeNull();
      expect(result.stderr).not.toContain('must-never-copy-secret');
    }
  });
  it('generates organization workflows, artifacts, AI and isolated runner without secrets or review defaults', () => {
    const { status, config } = generate();
    expect(status).toBe(0);
    expect(
      config.d1_databases.map((d: { binding: string }) => d.binding),
    ).toEqual(['DB', 'ORG_DB']);
    expect(config.workflows.map((w: { binding: string }) => w.binding)).toEqual(
      ['EVALUATOR', 'ORG_EVALUATOR'],
    );
    expect(config.kv_namespaces[0].binding).toBe('ARTIFACT_KV');
    expect(config.ai).toEqual({ binding: 'AI' });
    expect(config.services).toEqual([]);
    expect(config.vars).toMatchObject({
      ENVIRONMENT: 'production',
      PREVIEW_TESTING: 'false',
      DEMO_MODE: 'false',
      RUNNER_ENABLED: 'true',
      AI_PROVIDER: 'cloudflare',
    });
    expect(config.preview_urls).toBe(false);
    expect(JSON.stringify(config)).not.toMatch(
      /must-never-copy-secret|ORG_REVIEW_ORIGINS|cbbc7d68|35f5053d/,
    );
    const callmissed = generate({
      PRODUCTION_AI_PROVIDER: 'callmissed',
      PRODUCTION_AI_MODEL: 'kimi-k2.6',
    }).config;
    expect(callmissed.vars.CALLMISSED_MODEL).toBe('kimi-k2.6');
    expect(callmissed.vars.AI_MODEL).toBeUndefined();
  });
});
