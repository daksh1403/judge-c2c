import { afterEach, expect, it, vi } from 'vitest';
import {
  aiReview,
  deterministicReport,
  objective,
  type Context,
} from '../src/evaluate';
import { demoContract } from '../src/demo';
import type { Env } from '../src/env';
const context: Context = {
  files: [],
  sources: {},
  risk: [],
  environment: 'fixture',
  toolVersion: 'fixture',
};
const evidence = objective(demoContract, context);
const env = {
  AI_PROVIDER: 'callmissed',
  CALLMISSED_API_KEY: 'fixture-not-a-real-key',
  CALLMISSED_MODEL: 'kimi-k2.6',
} as Env;
afterEach(() => vi.unstubAllGlobals());
it('uses fixed CallMissed Responses endpoint and strict schema with no tools or stored conversation', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      id: 'resp_fixture',
      model: env.CALLMISSED_MODEL,
      status: 'completed',
      usage: { total_tokens: 42 },
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify(deterministicReport(demoContract, evidence)),
            },
          ],
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const result = await aiReview(env, demoContract, context, evidence);
  expect(result.status).toBe('COMPLETED');
  expect(result.trace).toMatchObject({
    provider: 'callmissed',
    model: env.CALLMISSED_MODEL,
    responseId: 'resp_fixture',
    usage: { total_tokens: 42 },
  });
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://api.callmissed.com/v1/responses');
  expect(init.redirect).toBe('manual');
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({
    store: false,
    text: { format: { type: 'json_schema', strict: true } },
  });
  expect(body.tools).toBeUndefined();
  expect(body.input).not.toContain(env.CALLMISSED_API_KEY);
});
it.each([401, 429, 500, 302])(
  'preserves deterministic evidence on CallMissed HTTP %s without persisting response secrets',
  async (status) => {
    const fetcher = vi
      .fn()
      .mockImplementation(
        async () => new Response('secret-error-body', { status }),
      );
    vi.stubGlobal('fetch', fetcher);
    const result = await aiReview(env, demoContract, context, evidence);
    expect(result.status).toBe('FAILED');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.review.assessments[0]!.status).toBe('UNVERIFIED');
    expect(JSON.stringify(result)).not.toContain('secret-error-body');
    expect(JSON.stringify(result)).not.toContain(env.CALLMISSED_API_KEY);
  },
);
it.each(['incomplete', 'refused'])(
  'never accepts CallMissed %s response as a valid review',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () => Response.json({ status, output: [] })),
    );
    expect((await aiReview(env, demoContract, context, evidence)).status).toBe(
      'FAILED',
    );
  },
);
it('does not silently fall back to another provider when the CallMissed key is absent', async () => {
  const run = vi.fn();
  const result = await aiReview(
    { ...env, CALLMISSED_API_KEY: undefined, AI: { run } } as unknown as Env,
    demoContract,
    context,
    evidence,
  );
  expect(result.status).toBe('NOT_CONFIGURED');
  expect(run).not.toHaveBeenCalled();
});
