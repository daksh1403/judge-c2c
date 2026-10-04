import type { Env } from './env';
import type { EvaluationPlan } from './evaluation-plan';

// Bounded server identifiers do not establish provider availability or capability.
function validModel(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9@][A-Za-z0-9._/@:-]{0,199}$/.test(value)
  );
}

export function selectReviewModel(
  env: Pick<
    Env,
    | 'AI_MODEL'
    | 'AI_MODEL_LIGHT'
    | 'AI_MODEL_DEEP'
    | 'CALLMISSED_MODEL'
    | 'CALLMISSED_MODEL_LIGHT'
    | 'CALLMISSED_MODEL_DEEP'
  >,
  provider: NonNullable<Env['AI_PROVIDER']>,
  plan: Pick<EvaluationPlan, 'depth'>,
): {
  version: 'server-model-routing-v1';
  model: string | null;
  reason: string;
} {
  const baseField = provider === 'callmissed' ? 'CALLMISSED_MODEL' : 'AI_MODEL';
  const overrideField =
    plan.depth === 'LIGHT'
      ? provider === 'callmissed'
        ? 'CALLMISSED_MODEL_LIGHT'
        : 'AI_MODEL_LIGHT'
      : plan.depth === 'DEEP'
        ? provider === 'callmissed'
          ? 'CALLMISSED_MODEL_DEEP'
          : 'AI_MODEL_DEEP'
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
