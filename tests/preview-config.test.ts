import { describe, expect, it } from 'vitest';
import { parse } from 'jsonc-parser';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('preview configuration isolation', () => {
  it('authorizes PR7 explicitly only in the organization review backend', () => {
    const config = parse(readFileSync('wrangler.jsonc', 'utf8'));
    const approved =
      'https://feat-frontend-polish-judge-c2c.dakshx.workers.dev';
    const origins = config.env.review.vars.ORG_REVIEW_ORIGINS.split(',');
    expect(origins).toContain(approved);
    expect(origins).not.toContain(
      'https://unapproved-judge-c2c.dakshx.workers.dev',
    );
    expect(
      origins.every((origin: string) => new URL(origin).origin === origin),
    ).toBe(true);
    expect(origins.some((origin: string) => origin.includes('*'))).toBe(false);
    expect(config.vars.ORG_REVIEW_ORIGINS).toBeUndefined();
    expect(config.previews.vars.ORG_REVIEW_ORIGINS).toBeUndefined();
  });

  it('keeps generated PR demos free of organization resources and secrets', () => {
    const directory = mkdtempSync(join(tmpdir(), 'judge-preview-config-'));
    try {
      const result = spawnSync(
        process.execPath,
        [resolve('scripts/preview-config.mjs')],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH,
            PR_NUMBER: '7',
            ORG_ADMIN_TOKEN: 'must-never-copy-secret',
            ORG_REVIEW_ORIGINS: 'https://attacker.test',
          },
          encoding: 'utf8',
        },
      );
      expect(result.status).toBe(0);
      const config = JSON.parse(
        readFileSync(join(directory, '.wrangler/pr-review.json'), 'utf8'),
      );
      expect(config.vars).toEqual({ ENVIRONMENT: 'review', DEMO_MODE: 'true' });
      expect(config.d1_databases).toBeUndefined();
      expect(config.services).toBeUndefined();
      expect(JSON.stringify(config)).not.toMatch(
        /ORG_|must-never-copy-secret|attacker/,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
