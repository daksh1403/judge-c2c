import type { Contract } from './domain';
import type { Context } from './evaluate';

export type EvaluationPlan = {
  version: 'adaptive-review-v1';
  depth: 'LIGHT' | 'STANDARD' | 'DEEP';
  reviewAreas: string[];
  reasons: string[];
  maxContextBytes: number;
  maxChangedFiles: number;
};

const budgets = {
  LIGHT: { maxContextBytes: 12_000, maxChangedFiles: 10 },
  STANDARD: { maxContextBytes: 48_000, maxChangedFiles: 30 },
  DEEP: { maxContextBytes: 64_000, maxChangedFiles: 100 },
} as const;

function documentationPath(path: string) {
  return /\.(?:md|mdx|rst|txt)$/i.test(path);
}

/** Advisory review breadth only: never filters criteria, evidence, or runner checks.
 * Participant prose and patch contents cannot request a depth or alter budgets.
 */
export function buildEvaluationPlan(
  contract: Contract,
  context: Pick<Context, 'files' | 'risk'>,
): EvaluationPlan {
  const criteria = contract.requirements.flatMap((r) => r.criteria);
  const paths = context.files.flatMap((f) => [
    f.filename,
    ...(f.previous_filename ? [f.previous_filename] : []),
  ]);
  // Additional categories permit findings; they do not request work.
  const categories = [contract.category.toLowerCase()];
  const risk = new Set(context.risk);
  const areas = new Set(['requirements', 'policy', 'solution-approach']);
  const reasons = [
    'All frozen contract criteria remain required at every review depth.',
    'Authoritative execution checks are unchanged by this advisory plan.',
  ];
  const functional = criteria.some((c) => c.kind === 'functional');
  const execution =
    criteria.some((c) => c.verification.type === 'runner') ||
    !!contract.execution.runner;
  const docsOnly = paths.length > 0 && paths.every(documentationPath);
  let depth: EvaluationPlan['depth'] =
    docsOnly && !functional && !execution ? 'LIGHT' : 'STANDARD';
  reasons.push(
    docsOnly
      ? 'Changed paths contain documentation only.'
      : 'Changes require standard source review or have no changed-path evidence.',
  );
  if (criteria.some((c) => c.kind === 'documentation') || docsOnly)
    areas.add('documentation');
  if (criteria.some((c) => c.kind === 'source') || !docsOnly)
    areas.add('source-review');
  if (functional || execution) {
    areas.add('correctness');
    areas.add('testing');
    reasons.push(
      'Functional criteria or trusted runner checks require objective verification.',
    );
  }
  const security =
    risk.has('sensitive-component') ||
    risk.has('dependencies') ||
    contract.analysis?.dependencyAudit === 'OSV_NPM_V1' ||
    paths.some(
      (p) =>
        /auth|permission|session|crypto|secret/i.test(p) ||
        /(?:^|\/)(?:package[^/]*\.json|[^/]*lock[^/]*|requirements[^/]*|go\.mod|cargo\.toml)$/i.test(
          p,
        ),
    ) ||
    categories.some((c) => /security|authentication|authorization/.test(c));
  if (security) {
    depth = 'DEEP';
    areas.add('security');
    reasons.push(
      'Sensitive components, dependencies, or authoritative security scope require deep review.',
    );
  }
  const performance =
    categories.some((c) => /performance|benchmark/.test(c)) ||
    !!contract.execution.runner?.benchmarks?.length;
  if (performance) {
    depth = 'DEEP';
    areas.add('performance');
    areas.add('benchmarks');
    reasons.push(
      'Authoritative performance scope or trusted benchmarks require deep review.',
    );
  }
  const large =
    context.files.length > 30 ||
    context.files.reduce((n, f) => n + f.additions + f.deletions, 0) > 500 ||
    risk.has('large-change');
  const architecture =
    categories.some((c) => /architecture|refactor/.test(c)) ||
    risk.has('architecture-change');
  if (large || architecture) {
    depth = 'DEEP';
    areas.add('architecture');
    areas.add('maintainability');
    reasons.push(
      large
        ? 'Change size exceeds the standard review threshold (30 files or 500 changed lines).'
        : 'Authoritative architecture scope requires deep review.',
    );
  }
  if (risk.has('execution-configuration')) {
    if (depth === 'LIGHT') depth = 'STANDARD';
    areas.add('execution-configuration');
    reasons.push('Execution configuration changes need focused review.');
  }
  if (risk.has('test-removal-review')) {
    if (depth === 'LIGHT') depth = 'STANDARD';
    areas.add('testing');
    reasons.push('Removed test content needs focused review.');
  }
  if (context.files.some((f) => f.patchTruncated)) {
    if (depth === 'LIGHT') depth = 'STANDARD';
    reasons.push(
      'Truncated patches limit review evidence and require explicit uncertainty.',
    );
  }
  return {
    version: 'adaptive-review-v1',
    depth,
    reviewAreas: [...areas].sort(),
    reasons,
    ...budgets[depth],
    maxChangedFiles: Math.min(
      budgets[depth].maxChangedFiles,
      contract.execution.maxFiles,
    ),
  };
}
