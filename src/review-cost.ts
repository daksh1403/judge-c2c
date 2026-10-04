import { z } from 'zod';
const prices = z.record(
  z.string().max(200),
  z
    .object({
      inputUsdPerMillion: z.number().nonnegative().max(10000),
      outputUsdPerMillion: z.number().nonnegative().max(10000),
    })
    .strict(),
);
/** Estimate only the successful final response, using organizer-supplied rates.
 * Retrieval and failed requests are not billed here: this is never total cost. */
export function reviewCost(
  pricing: string | undefined,
  provider: string,
  model: string,
  usage: unknown,
) {
  const missing = {
    status: 'UNAVAILABLE' as const,
    scope: 'successful-final-response' as const,
    reason:
      'Known rates and actual provider token usage are required; this is not total review billing.',
  };
  if (!pricing || pricing.length > 16000 || !usage || typeof usage !== 'object')
    return missing;
  try {
    const rates = prices.parse(JSON.parse(pricing))[`${provider}/${model}`];
    const u = usage as Record<string, unknown>;
    const input = u.input_tokens ?? u.prompt_tokens,
      output = u.output_tokens ?? u.completion_tokens;
    if (
      !rates ||
      typeof input !== 'number' ||
      typeof output !== 'number' ||
      !Number.isSafeInteger(input) ||
      !Number.isSafeInteger(output) ||
      input < 0 ||
      output < 0 ||
      input > 1e8 ||
      output > 1e8
    )
      return missing;
    return {
      status: 'ESTIMATE' as const,
      scope: 'successful-final-response' as const,
      currency: 'USD' as const,
      microUsd: Math.round(
        input * rates.inputUsdPerMillion + output * rates.outputUsdPerMillion,
      ),
      inputTokens: input,
      outputTokens: output,
      rates,
      excludes: 'Retrieval, failed requests and other provider billing.',
    };
  } catch {
    return missing;
  }
}
