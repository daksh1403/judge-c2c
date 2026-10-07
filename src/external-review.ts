import type { Env } from './env';
import { boundedBody } from './security';
export type ExternalProvider = 'gemini' | 'groq';
export function providerHasKey(
  env: Partial<Env>,
  provider = env.AI_PROVIDER ?? 'cloudflare',
) {
  switch (provider) {
    case 'gemini':
      return !!env.GEMINI_API_KEY;
    case 'groq':
      return !!env.GROQ_API_KEY;
    case 'callmissed':
      return !!env.CALLMISSED_API_KEY;
    default:
      return !!env.AI;
  }
}
export function providerConfigured(
  env: Partial<Env>,
  provider = env.AI_PROVIDER ?? 'cloudflare',
) {
  switch (provider) {
    case 'gemini':
      return !!env.GEMINI_API_KEY && !!env.GEMINI_MODEL;
    case 'groq':
      return !!env.GROQ_API_KEY && !!env.GROQ_MODEL;
    case 'callmissed':
      return !!env.CALLMISSED_API_KEY && !!env.CALLMISSED_MODEL;
    default:
      return !!env.AI && !!env.AI_MODEL;
  }
}
export async function externalReview(
  env: Env,
  provider: ExternalProvider,
  model: string,
  policy: string,
  prompt: string,
  attempt: number,
  repairCode: string | undefined,
  schema: Record<string, unknown>,
) {
  const key = provider === 'gemini' ? env.GEMINI_API_KEY : env.GROQ_API_KEY;
  const code = provider.toUpperCase();
  if (!key || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(model))
    throw new Error(code + '_NOT_CONFIGURED');
  const context = JSON.stringify({
    schema,
    untrustedContext: prompt,
    attempt,
    ...(repairCode ? { trustedValidationFeedback: { code: repairCode } } : {}),
  });
  let response: Response;
  try {
    response = await fetch(
      provider === 'gemini'
        ? 'https://generativelanguage.googleapis.com/v1beta/models/' +
            encodeURIComponent(model) +
            ':generateContent'
        : 'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(65000),
        headers: {
          'content-type': 'application/json',
          ...(provider === 'gemini'
            ? { 'x-goog-api-key': key }
            : { authorization: 'Bearer ' + key }),
        },
        body: JSON.stringify(
          provider === 'gemini'
            ? {
                systemInstruction: { parts: [{ text: policy }] },
                contents: [{ role: 'user', parts: [{ text: context }] }],
                generationConfig: {
                  responseMimeType: 'application/json',
                  maxOutputTokens: 8192,
                  temperature: 0,
                },
              }
            : {
                model,
                messages: [
                  { role: 'system', content: policy },
                  { role: 'user', content: context },
                ],
                response_format: { type: 'json_object' },
                max_completion_tokens: 4500,
                temperature: 0,
              },
        ),
      },
    );
  } catch {
    throw new Error(code + '_TRANSPORT_UNAVAILABLE');
  }
  // Never retain provider error bodies: they may echo credentials or context.
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(code + '_HTTP_' + response.status);
  }
  const bytes = await boundedBody(
    new Request('https://internal/', {
      method: 'POST',
      body: response.body,
      duplex: 'half',
    } as RequestInit),
    256000,
  );
  const data = JSON.parse(new TextDecoder().decode(bytes));
  let output: string | undefined;
  if (provider === 'gemini') {
    if (
      data.candidates?.length !== 1 ||
      data.candidates[0].finishReason !== 'STOP'
    )
      throw new Error(code + '_INCOMPLETE');
    output = data.candidates[0].content?.parts
      ?.filter((p: { thought?: boolean }) => !p.thought)
      .map((p: { text?: string }) => p.text ?? '')
      .join('');
  } else {
    if (
      data.choices?.length !== 1 ||
      data.choices[0].finish_reason !== 'stop' ||
      data.choices[0].message?.refusal
    )
      throw new Error(code + '_INCOMPLETE');
    output = data.choices[0].message?.content;
  }
  if (!output || typeof output !== 'string') throw new Error(code + '_EMPTY');
  const usage =
    provider === 'gemini' && data.usageMetadata
      ? {
          prompt_tokens: data.usageMetadata.promptTokenCount,
          completion_tokens: data.usageMetadata.candidatesTokenCount,
          total_tokens: data.usageMetadata.totalTokenCount,
        }
      : (data.usage ?? null);
  return {
    response: JSON.parse(output) as unknown,
    usage,
    model:
      provider === 'gemini'
        ? (data.modelVersion ?? model)
        : (data.model ?? model),
    responseId: data.responseId ?? data.id ?? null,
  };
}
