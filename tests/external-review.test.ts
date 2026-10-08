import { afterEach, expect, it, vi } from 'vitest';
import { externalReview, providerConfigured } from '../src/external-review';
import { selectReviewModel } from '../src/review-routing';
import type { Env } from '../src/env';
afterEach(() => vi.unstubAllGlobals());
const env = {
  GEMINI_API_KEY: 'private-gemini-fixture',
  GROQ_API_KEY: 'private-groq-fixture',
} as Env;
const schema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
};
it.each(['gemini', 'groq'] as const)(
  'uses fixed %s origin and keeps credentials out of context',
  async (provider) => {
    const fetcher = vi.fn(async () =>
      Response.json(
        provider === 'gemini'
          ? {
              candidates: [
                {
                  finishReason: 'STOP',
                  content: { parts: [{ text: '{"answer":"ok"}' }] },
                },
              ],
              usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
              modelVersion: 'fixture-gemini',
            }
          : {
              choices: [
                {
                  finish_reason: 'stop',
                  message: { content: '{"answer":"ok"}' },
                },
              ],
              usage: { prompt_tokens: 3, completion_tokens: 4 },
              model: 'fixture-groq',
            },
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await externalReview(
      env,
      provider,
      'fixture-model',
      'trusted policy',
      'hostile source',
      0,
      undefined,
      schema,
    );
    expect(result.response).toEqual({ answer: 'ok' });
    expect(result.usage).toMatchObject({
      prompt_tokens: 3,
      completion_tokens: 4,
    });
    const [url, init] = fetcher.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(
      provider === 'gemini'
        ? /^https:\/\/generativelanguage.googleapis.com\//
        : /^https:\/\/api.groq.com\//,
    );
    expect(init.redirect).toBe('manual');
    expect(init.body).not.toContain('private-');
    expect(init.body).not.toContain('"tools"');
  },
);
it.each(['gemini', 'groq'] as const)(
  'refuses truncated %s output and sanitized HTTP failures',
  async (provider) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          provider === 'gemini'
            ? {
                candidates: [
                  {
                    finishReason: 'MAX_TOKENS',
                    content: { parts: [{ text: '{}' }] },
                  },
                ],
              }
            : {
                choices: [
                  { finish_reason: 'length', message: { content: '{}' } },
                ],
              },
        ),
      ),
    );
    await expect(
      externalReview(
        env,
        provider,
        'model',
        'policy',
        'source',
        0,
        undefined,
        schema,
      ),
    ).rejects.toThrow('INCOMPLETE');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('private-provider-error', { status: 429 }),
      ),
    );
    await expect(
      externalReview(
        env,
        provider,
        'model',
        'policy',
        'source',
        0,
        undefined,
        schema,
      ),
    ).rejects.toThrow(provider.toUpperCase() + '_HTTP_429');
  },
);
it('requires explicit key/model and routes provider-specific depth models', () => {
  expect(providerConfigured({ ...env, GEMINI_MODEL: 'base' }, 'gemini')).toBe(
    true,
  );
  expect(providerConfigured(env, 'groq')).toBe(false);
  expect(
    selectReviewModel(
      { GEMINI_MODEL: 'base', GEMINI_MODEL_DEEP: 'deep' },
      'gemini',
      { depth: 'DEEP' },
    ).model,
  ).toBe('deep');
  expect(
    selectReviewModel({ GROQ_MODEL: 'groq' }, 'groq', { depth: 'LIGHT' }).model,
  ).toBe('groq');
});

it.each(['gemini', 'groq'] as const)(
  'keeps %s behind the authoritative evidence validator and does not retry quota failures',
  async (provider) => {
    const { aiReview, deterministicReport, objective } =
      await import('../src/evaluate');
    const { demoContract } = await import('../src/demo');
    const context = {
      files: [],
      sources: {},
      risk: [],
      environment: 'fixture',
      toolVersion: 'fixture',
    };
    const evidence = objective(demoContract, context);
    const review = deterministicReport(demoContract, evidence);
    const model = 'fixture-model';
    const configured = {
      ...env,
      AI_PROVIDER: provider,
      GEMINI_MODEL: model,
      GROQ_MODEL: model,
    } as Env;
    const wrap = (value: unknown) =>
      Response.json(
        provider === 'gemini'
          ? {
              candidates: [
                {
                  finishReason: 'STOP',
                  content: { parts: [{ text: JSON.stringify(value) }] },
                },
              ],
            }
          : {
              choices: [
                {
                  finish_reason: 'stop',
                  message: { content: JSON.stringify(value) },
                },
              ],
            },
      );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => wrap(review)),
    );
    expect(
      (await aiReview(configured, demoContract, context, evidence)).status,
    ).toBe('COMPLETED');
    const bad = structuredClone(review);
    bad.assessments[0]!.evidenceIds = ['invented-evidence'];
    const invalid = vi.fn(async () => wrap(bad));
    vi.stubGlobal('fetch', invalid);
    const rejected = await aiReview(
      configured,
      demoContract,
      context,
      evidence,
    );
    expect(rejected.status).toBe('FAILED');
    expect(invalid).toHaveBeenCalledTimes(2);
    const quota = vi.fn(
      async () => new Response('secret error body', { status: 429 }),
    );
    vi.stubGlobal('fetch', quota);
    const unavailable = await aiReview(
      configured,
      demoContract,
      context,
      evidence,
    );
    expect(unavailable.status).toBe('FAILED');
    expect(unavailable.trace.failureCode).toBe(
      provider.toUpperCase() + '_HTTP_429',
    );
    expect(quota).toHaveBeenCalledTimes(1);
  },
);
