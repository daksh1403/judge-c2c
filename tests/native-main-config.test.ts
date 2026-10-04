import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'jsonc-parser';

const config = parse(readFileSync('wrangler.jsonc', 'utf8'));

describe('native main frontend review connection', () => {
  it('routes organization requests to the existing isolated review service', () => {
    expect(config.services).toEqual([
      { binding: 'ORG_SERVICE', service: 'judge-c2c-review' },
    ]);
    expect(config.previews.services).toEqual(config.services);
    expect(config.env.review.services).toEqual([]);
    expect(config.vars).toEqual({
      ENVIRONMENT: 'review',
      DEMO_MODE: 'true',
      PREVIEW_TESTING: 'true',
    });
    expect(
      config.d1_databases.map(
        (binding: { binding: string; database_name: string }) => ({
          binding: binding.binding,
          name: binding.database_name,
        }),
      ),
    ).toEqual([{ binding: 'DB', name: 'judge-c2c-review' }]);
    expect(config.workflows).toEqual([
      {
        binding: 'PREVIEW_EVALUATOR',
        name: 'judge-c2c-public-preview-evaluator',
        class_name: 'PublicPreviewWorkflow',
        script_name: 'judge-c2c-review',
      },
    ]);
    expect(config.ai).toBeUndefined();
    expect(config.r2_buckets).toBeUndefined();
    expect(config.kv_namespaces).toBeUndefined();
    const { env: _environments, ...frontend } = config;
    expect(JSON.stringify(frontend)).not.toMatch(
      /GITHUB_APP|PRIVATE_KEY|ORG_ADMIN_TOKEN|CALLMISSED_API_KEY|production|judge-c2c-prod/,
    );
  });

  it('authorizes the native main origin exactly while retaining PR review origins', () => {
    const origins: string[] =
      config.env.review.vars.ORG_REVIEW_ORIGINS.split(',');
    expect(origins).toContain('https://judge-c2c.dakshx.workers.dev');
    expect(origins).toContain(
      'https://feat-frontend-polish-judge-c2c.dakshx.workers.dev',
    );
    expect(origins).toContain(
      'https://feat-evaluation-completeness-judge-c2c.dakshx.workers.dev',
    );
    expect(origins).not.toContain(
      'https://unapproved-judge-c2c.dakshx.workers.dev',
    );
    expect(new Set(origins).size).toBe(origins.length);
    expect(
      origins.every(
        (origin) => new URL(origin).origin === origin && !origin.includes('*'),
      ),
    ).toBe(true);
    expect(config.vars.ORG_REVIEW_ORIGINS).toBeUndefined();
    expect(config.previews.vars.ORG_REVIEW_ORIGINS).toBeUndefined();
  });
});
