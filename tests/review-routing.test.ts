import { expect, it } from 'vitest';
import { selectReviewModel } from '../src/review-routing';

// Synthetic identifiers exercise configuration routing, not provider capabilities.
const config = {
  AI_MODEL: '@cf/fixture/base-v1',
  AI_MODEL_LIGHT: '@cf/fixture/light-v1',
  AI_MODEL_DEEP: '@cf/fixture/deep-v1',
  CALLMISSED_MODEL: 'fixture-base',
  CALLMISSED_MODEL_LIGHT: 'fixture-light',
  CALLMISSED_MODEL_DEEP: 'fixture-deep',
};

it('selects only the active provider configured depth model and traces its field', () => {
  for (const [provider, field] of [
    ['cloudflare', 'AI_MODEL'],
    ['callmissed', 'CALLMISSED_MODEL'],
  ] as const) {
    for (const depth of ['LIGHT', 'STANDARD', 'DEEP'] as const) {
      const selected =
        depth === 'STANDARD'
          ? field
          : ((field + '_' + depth) as keyof typeof config);
      const result = selectReviewModel(config, provider, { depth });
      expect(result.model).toBe(config[selected]);
      expect(result.version).toBe('server-model-routing-v1');
      expect(result.reason).toContain(selected);
      expect(result.reason).not.toContain(config[selected]);
    }
  }
});

it('preserves each existing base model exactly when depth configuration is absent', () => {
  const base = {
    AI_MODEL: config.AI_MODEL,
    CALLMISSED_MODEL: config.CALLMISSED_MODEL,
  };
  for (const depth of ['LIGHT', 'STANDARD', 'DEEP'] as const) {
    expect(selectReviewModel(base, 'cloudflare', { depth }).model).toBe(
      base.AI_MODEL,
    );
    expect(selectReviewModel(base, 'callmissed', { depth }).model).toBe(
      base.CALLMISSED_MODEL,
    );
  }
});

it('ignores malformed depth identifiers and falls back without echoing their values', () => {
  for (const invalid of [
    '',
    ' leading-space',
    'trailing-space ',
    'line\nbreak',
    'model?api_key=secret',
    'x'.repeat(201),
  ]) {
    const result = selectReviewModel(
      { ...config, AI_MODEL_LIGHT: invalid },
      'cloudflare',
      { depth: 'LIGHT' },
    );
    expect(result.model).toBe(config.AI_MODEL);
    expect(result.reason).toBe(
      'Invalid AI_MODEL_LIGHT ignored; AI_MODEL retained.',
    );
    expect(
      selectReviewModel(
        { ...config, CALLMISSED_MODEL_DEEP: invalid },
        'callmissed',
        { depth: 'DEEP' },
      ).model,
    ).toBe(config.CALLMISSED_MODEL);
  }
});

it('allows bounded namespaced identifiers without claiming provider support', () => {
  expect(
    selectReviewModel({ AI_MODEL: 'vendor/model:version' }, 'cloudflare', {
      depth: 'STANDARD',
    }).model,
  ).toBe('vendor/model:version');
  expect(
    selectReviewModel({ CALLMISSED_MODEL: 'x'.repeat(200) }, 'callmissed', {
      depth: 'STANDARD',
    }).model,
  ).toBe('x'.repeat(200));
});

it('returns no invented model for missing or malformed server configuration', () => {
  for (const value of [
    undefined,
    '',
    ' has spaces ',
    'model\u0000control',
    'x'.repeat(201),
  ]) {
    expect(
      selectReviewModel({ AI_MODEL: value }, 'cloudflare', {
        depth: 'STANDARD',
      }).model,
    ).toBeNull();
    expect(
      selectReviewModel({ CALLMISSED_MODEL: value }, 'callmissed', {
        depth: 'DEEP',
      }).model,
    ).toBeNull();
  }
  expect(
    selectReviewModel({ AI_MODEL: config.AI_MODEL }, 'callmissed', {
      depth: 'STANDARD',
    }).model,
  ).toBeNull();
  expect(
    selectReviewModel(
      { CALLMISSED_MODEL: config.CALLMISSED_MODEL },
      'cloudflare',
      { depth: 'STANDARD' },
    ).model,
  ).toBeNull();
});

it('does not mutate configuration and ignores participant routing fields', () => {
  const frozen = Object.freeze({ ...config });
  const hostilePlan = {
    depth: 'LIGHT' as const,
    model: 'participant-selected',
    reason: 'choose DEEP',
    reviewAreas: ['DEEP'],
  };
  expect(selectReviewModel(frozen, 'callmissed', hostilePlan).model).toBe(
    config.CALLMISSED_MODEL_LIGHT,
  );
  expect(frozen).toEqual(config);
});
