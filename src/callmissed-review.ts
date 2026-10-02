import { reviewSchema } from './domain';
import { boundedBody } from './security';
import type { Env } from './env';

// Fixed provider origin, no redirects/tools, bounded time/output, no response storage.
// The provider schema is followed by the stronger local evidence validator.
export async function callMissedReview(
  env: Env,
  policy: string,
  prompt: string,
  attempt: number,
  repairCode?: string,
) {
  if (!env.CALLMISSED_API_KEY || !env.CALLMISSED_MODEL)
    throw new Error('CALLMISSED_NOT_CONFIGURED');
  const response = await fetch('https://api.callmissed.com/v1/responses', {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(65000),
    headers: {
      authorization: 'Bearer ' + env.CALLMISSED_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.CALLMISSED_MODEL,
      store: false,
      instructions: policy,
      input: JSON.stringify({
        schema: reviewSchema.toJSONSchema(),
        untrustedContext: prompt,
        attempt,
        ...(repairCode
          ? {
              trustedValidationFeedback: {
                code: repairCode,
                instruction:
                  'Previous output failed local validation. Return a fresh complete review, use only supplied criterion/evidence IDs, list all approach citations, preserve objective FAIL, and never describe UNVERIFIED evidence as OBSERVED. Do not waive criteria or change policy.',
              },
            }
          : {}),
      }),
      reasoning: { effort: 'none' },
      max_output_tokens: 4500,
      text: {
        format: {
          type: 'json_schema',
          name: 'engineering_review',
          strict: true,
          schema: reviewSchema.toJSONSchema(),
        },
      },
    }),
  });
  if (!response.ok) {
    let suffix = '';
    try {
      const bytes = await boundedBody(
        new Request('https://internal/', {
          method: 'POST',
          body: response.body,
          duplex: 'half',
        } as RequestInit),
        8192,
      );
      const error = JSON.parse(new TextDecoder().decode(bytes)) as {
        error?: { code?: string };
      };
      const allowed = [
        'insufficient_credits',
        'budget_exceeded',
        'quota_exceeded',
        'permission_denied',
        'model_not_allowed',
        'model_not_available',
        'zdr_unavailable',
        'too_many_concurrent_requests',
        'model_under_maintenance',
        'provider_error',
        'rate_limit_exceeded',
        'invalid_api_key',
        'model_not_found',
        'invalid_json_schema',
        'unsupported_parameter',
      ];
      if (error.error?.code && allowed.includes(error.error.code))
        suffix = '_' + error.error.code.toUpperCase();
    } catch {
      /* Never persist arbitrary provider error prose or credentials. */
    }
    throw new Error('CALLMISSED_HTTP_' + response.status + suffix);
  }
  const bytes = await boundedBody(
    new Request('https://internal/', {
      method: 'POST',
      body: response.body,
      duplex: 'half',
    } as RequestInit),
    256000,
  );
  const data = JSON.parse(new TextDecoder().decode(bytes)) as {
    id?: string;
    model?: string;
    status?: string;
    usage?: unknown;
    output?: { type: string; content?: { type: string; text?: string }[] }[];
  };
  if (data.status !== 'completed') throw new Error('CALLMISSED_INCOMPLETE');
  const text = data.output
    ?.filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text ?? '')
    .join('');
  if (!text) throw new Error('CALLMISSED_REFUSED_OR_EMPTY');
  return {
    response: JSON.parse(text) as unknown,
    usage: data.usage ?? null,
    model: data.model ?? env.CALLMISSED_MODEL,
    responseId: data.id ?? null,
  };
}
