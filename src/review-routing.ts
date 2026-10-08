import type { Env } from './env';
import type { EvaluationPlan } from './evaluation-plan';

// Bounded server identifiers do not establish provider availability or capability.
function validModel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9@][A-Za-z0-9._/@:-]{0,199}$/.test(value)
  );
}

export function selectReviewModel(
  env: Partial<Env>,
  provider: NonNullable<Env['AI_PROVIDER']>,
  plan: Pick<EvaluationPlan, 'depth'>,
): {
  version: 'server-model-routing-v1';
  model: string | null;
  reason: string;
} {
  const prefix = {
    cloudflare: 'AI',
    callmissed: 'CALLMISSED',
    gemini: 'GEMINI',
    groq: 'GROQ',
  }[provider];
  const baseField = (prefix + '_MODEL') as keyof Env;
  const overrideField =
    plan.depth === 'LIGHT' || plan.depth === 'DEEP'
      ? ((prefix + '_MODEL_' + plan.depth) as keyof Env)
      : null;
  const base = env[baseField],
    override = overrideField ? env[overrideField] : undefined;
  const version = 'server-model-routing-v1' as const;
  if (validModel(override))
    return {
      version,
      model: override,
      reason: overrideField + ' selected for ' + plan.depth + ' review.',
    };
  if (validModel(base))
    return {
      version,
      model: base,
      reason:
        override === undefined
          ? baseField + ' retained; no depth override is configured.'
          : 'Invalid ' +
            overrideField +
            ' ignored; ' +
            baseField +
            ' retained.',
    };
  return {
    version,
    model: null,
    reason:
      'No valid model configured in ' +
      baseField +
      ' or the selected depth field.',
  };
}
