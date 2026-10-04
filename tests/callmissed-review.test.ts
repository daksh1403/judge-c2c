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
  const compact = JSON.parse(JSON.parse(body.input).untrustedContext);
  expect([...compact.citationGuide.knownEvidenceIds].sort()).toEqual(
    evidence.map((e) => e.id).sort(),
  );
  expect(compact.citationGuide.criterionEvidence['future-time']).toEqual(
    evidence.filter((e) => e.criterionId === 'future-time').map((e) => e.id),
  );
  expect([...body.text.format.schema.$defs.evidenceId.enum].sort()).toEqual(
    evidence.map((item) => item.id).sort(),
  );
  expect(
    body.text.format.schema.properties.assessments.items.properties.criterionId
      .enum,
  ).toEqual(
    demoContract.requirements.flatMap((requirement) =>
      requirement.criteria.map((criterion) => criterion.id),
    ),
  );
  expect(JSON.parse(body.input).schema).toEqual(body.text.format.schema);
  expect(body.max_output_tokens).toBe(4500);
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

it('reports provider timeout separately from invalid structured output', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')),
  );
  const result = await aiReview(env, demoContract, context, evidence);
  expect(result.status).toBe('FAILED');
  expect(result.trace).toMatchObject({
    failureCode: 'CALLMISSED_TIMEOUT',
    attempts: 2,
  });
});

it('repairs invalid citations with trusted static feedback without weakening validation', async () => {
  const valid = deterministicReport(demoContract, evidence);
  const invalid = structuredClone(valid);
  invalid.solution_approach.evidence = ['invented-evidence'];
  const envelope = (review: unknown) =>
    Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(review) }],
        },
      ],
    });
  const f = vi
    .fn()
    .mockResolvedValueOnce(envelope(invalid))
    .mockResolvedValueOnce(envelope(valid));
  vi.stubGlobal('fetch', f);
  const result = await aiReview(env, demoContract, context, evidence);
  expect(result.status).toBe('COMPLETED');
  expect(result.trace).toMatchObject({
    attempts: 2,
    attemptFailures: ['AI_CITATION_UNKNOWN'],
  });
  const second = JSON.parse(JSON.parse(f.mock.calls[1]![1].body).input);
  expect(second.trustedValidationFeedback.code).toBe('AI_CITATION_UNKNOWN');
  expect(second.trustedValidationFeedback.instruction).not.toContain(
    'invented-evidence',
  );
});

it.each([false, true])(
  'retrieves a bounded later excerpt and still reviews when optional retrieval fails (%s)',
  async (failSelection) => {
    const c: Context = {
      ...context,
      files: [
        { filename: 'api.ts', status: 'modified', additions: 2, deletions: 1 },
      ],
      sources: {
        'api.ts': {
          baseline: 'old',
          head: '// filler\n'.repeat(500) + 'export function later() {}',
        },
      },
    };
    const facts = objective(demoContract, c);
    const completed = (value: unknown) =>
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(value) }],
          },
        ],
      });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () =>
        failSelection
          ? new Response('provider-secret', { status: 500 })
          : completed({
              reads: [
                { path: 'api.ts', side: 'head', startLine: 501, lineCount: 1 },
              ],
            }),
      )
      .mockImplementation(async () =>
        completed(deterministicReport(demoContract, facts)),
      );
    vi.stubGlobal('fetch', fetcher);
    const result = await aiReview(env, demoContract, c, facts);
    expect(result.status).toBe('COMPLETED');
    expect(fetcher).toHaveBeenCalledTimes(2);
    if (failSelection)
      expect(result.trace).toMatchObject({
        retrievalFailure: 'RETRIEVAL_UNAVAILABLE',
      });
    else {
      expect(result.trace).toMatchObject({
        retrieval: { maxReads: 4, log: [{ path: 'api.ts', status: 'READ' }] },
      });
      const body = JSON.parse(fetcher.mock.calls[1]![1].body);
      expect(body.input).toContain('export function later()');
      expect(body.tools).toBeUndefined();
    }
    expect(JSON.stringify(result)).not.toContain('provider-secret');
  },
);

it('prices Cloudflare actual invoked model usage without treating a response alias as the billed route', async () => {
  const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const cf = {
    AI_PROVIDER: 'cloudflare',
    AI_MODEL: model,
    AI_PRICING_JSON: JSON.stringify({
      ['cloudflare/' + model]: {
        inputUsdPerMillion: 0.293,
        outputUsdPerMillion: 2.253,
      },
    }),
    AI: {
      run: vi.fn().mockResolvedValue({
        model: 'response-json-alias',
        response: JSON.stringify(deterministicReport(demoContract, evidence)),
        usage: { prompt_tokens: 1000, completion_tokens: 100 },
      }),
    },
  } as unknown as Env;
  const result = await aiReview(cf, demoContract, context, evidence);
  expect(result.status).toBe('COMPLETED');
  expect(result.trace).toMatchObject({
    model: 'response-json-alias',
    invokedModel: model,
    cost: {
      status: 'ESTIMATE',
      microUsd: 518,
      scope: 'successful-final-response',
    },
  });
});

it('repairs a known omitted approach declaration without retrying or promoting narrative truth', async () => {
  const review = deterministicReport(demoContract, evidence);
  review.solution_approach.maintainability = {
    text: 'The implementation is always maintainable.',
    evidenceIds: ['diff'],
    verification: 'OBSERVED',
  };
  review.solution_approach.evidence = [];
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(review) }],
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const result = await aiReview(env, demoContract, context, evidence);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(result.status).toBe('COMPLETED');
  expect(result.trace).toMatchObject({
    policy: 'requirements-and-approach-v15',
    approachEvidenceIndexRepair: ['diff'],
    objectiveCriterionRecovery: [],
    requiresHumanAttention: true,
  });
  expect(result.review.solution_approach.evidence).toEqual(['diff']);
  expect(result.review.solution_approach.maintainability.verification).toBe(
    'UNVERIFIED',
  );
});

it.each([
  ['AI_UNVERIFIED_OBSERVED', 'OBSERVED', 'criterion-future-time'],
  ['AI_APPROACH_UNSUPPORTED', 'INFERENCE', null],
] as const)(
  'gives precise source-only retry feedback for %s while accepting only valid provider uncertainty',
  async (code, verification, citation) => {
    const invalid = deterministicReport(demoContract, evidence);
    invalid.solution_approach.maintainability = {
      text: 'The implementation is maintainable.',
      verification,
      evidenceIds: citation ? [citation] : [],
    };
    invalid.solution_approach.evidence = citation ? [citation] : [];
    const valid = structuredClone(invalid);
    valid.solution_approach.maintainability = {
      text: 'Maintainability is unverified because no supporting source or execution evidence is supplied.',
      verification: 'UNVERIFIED',
      evidenceIds: [],
    };
    valid.solution_approach.evidence = [];
    const envelope = (review: unknown) =>
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(review) }],
          },
        ],
      });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(envelope(invalid))
      .mockResolvedValueOnce(envelope(valid));
    vi.stubGlobal('fetch', fetcher);
    const result = await aiReview(env, demoContract, context, evidence);
    expect(result.status).toBe('COMPLETED');
    expect(result.trace).toMatchObject({
      attemptFailures: [code],
      attempts: 2,
      objectiveCriterionRecovery: [],
      approachEvidenceIndexRepair: [],
    });
    const second = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(JSON.parse(second.input).trustedValidationFeedback.code).toBe(code);
    expect(second.instructions).toContain('Trusted validation repair:');
    expect(second.instructions).toContain('evidenceIds: []');
    expect(second.instructions).toContain('UNVERIFIED');
    expect(second.instructions).toContain(
      code === 'AI_UNVERIFIED_OBSERVED'
        ? 'Do not replace OBSERVED with uncited INFERENCE'
        : 'Do not fabricate evidence or a supported claim',
    );
    expect(result.review.solution_approach.maintainability).toEqual(
      valid.solution_approach.maintainability,
    );
    expect(
      result.review.assessments.every(
        (assessment) => assessment.status === 'UNVERIFIED',
      ),
    ).toBe(true);
  },
);

it('discards uncited inference after retry and leaves qualitative analysis explicitly unverified', async () => {
  const first = deterministicReport(demoContract, evidence);
  first.solution_approach.maintainability = {
    text: 'Everything is maintainable.',
    verification: 'OBSERVED',
    evidenceIds: ['criterion-future-time'],
  };
  first.solution_approach.evidence = ['criterion-future-time'];
  const second = structuredClone(first);
  second.solution_approach.maintainability = {
    text: 'Everything is maintainable.',
    verification: 'INFERENCE',
    evidenceIds: [],
  };
  second.solution_approach.evidence = [];
  const envelope = (review: unknown) =>
    Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(review) }],
        },
      ],
    });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(envelope(first))
    .mockResolvedValueOnce(envelope(second));
  vi.stubGlobal('fetch', fetcher);
  const result = await aiReview(env, demoContract, context, evidence);
  expect(result.status).toBe('NEEDS_REVIEW');
  expect(result.trace).toMatchObject({
    attempts: 2,
    attemptFailures: ['AI_UNVERIFIED_OBSERVED'],
    requiresHumanAttention: true,
    qualitativeClaimRejections: [
      {
        path: 'solution_approach.maintainability',
        reason: 'The reviewer supplied no supporting evidence.',
      },
    ],
  });
  expect(result.review.solution_approach.maintainability.verification).toBe(
    'UNVERIFIED',
  );
  expect(result.review.solution_approach.maintainability.evidenceIds).toEqual(
    [],
  );
  expect(result.review.solution_approach.maintainability.text).not.toContain(
    'Everything is maintainable',
  );
  expect(
    result.review.assessments.every(
      (assessment) => assessment.status === 'UNVERIFIED',
    ),
  ).toBe(true);
});

it('uses the same precise trusted uncertainty repair feedback for Cloudflare', async () => {
  const invalid = deterministicReport(demoContract, evidence);
  invalid.solution_approach.maintainability = {
    text: 'Unsupported maintainability interpretation.',
    verification: 'INFERENCE',
    evidenceIds: [],
  };
  const valid = structuredClone(invalid);
  valid.solution_approach.maintainability = {
    text: 'Maintainability lacks supporting evidence and requires human inspection.',
    verification: 'UNVERIFIED',
    evidenceIds: [],
  };
  const run = vi
    .fn()
    .mockResolvedValueOnce({ response: invalid })
    .mockResolvedValueOnce({ response: valid });
  const result = await aiReview(
    {
      AI_PROVIDER: 'cloudflare',
      AI_MODEL: 'synthetic/model',
      AI: { run },
    } as unknown as Env,
    demoContract,
    context,
    evidence,
  );
  expect(result.status).toBe('COMPLETED');
  expect(result.trace).toMatchObject({
    attemptFailures: ['AI_APPROACH_UNSUPPORTED'],
    attempts: 2,
  });
  const feedback = JSON.parse(
    run.mock.calls[1]![1].messages[1].content,
  ).trustedValidationFeedback;
  expect(feedback.code).toBe('AI_APPROACH_UNSUPPORTED');
  expect(feedback.instruction).toContain(
    'verification UNVERIFIED and evidenceIds: []',
  );
  expect(feedback.instruction).toContain(
    'Do not fabricate evidence or a supported claim',
  );
  expect(result.review.solution_approach.maintainability).toEqual(
    valid.solution_approach.maintainability,
  );
});
