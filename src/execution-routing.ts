import type { Contract, Evidence } from './domain';
import type { RunnerPolicy } from './runner-policy';

export type RunWhen =
  | 'ALWAYS'
  | 'SOURCE_CHANGE'
  | 'DEPENDENCY_CHANGE'
  | 'SECURITY_CHANGE'
  | 'PERFORMANCE_CHANGE';
export type FrozenExecutionContext = {
  files: { filename: string; previous_filename?: string }[];
  risk: string[];
};

/** Only organizer-opted supplemental checks may be omitted. Criteria and acceptance cases are immutable. */
export function routeExecution(
  contract: Pick<Contract, 'requirements'>,
  policy: RunnerPolicy,
  context: FrozenExecutionContext | null,
) {
  const required = new Set(
    contract.requirements.flatMap((r) =>
      r.criteria.flatMap((c) =>
        c.verification.type === 'runner' ? [c.verification.checkId] : [],
      ),
    ),
  );
  const paths =
    context?.files.flatMap((f) => [
      f.filename,
      ...(f.previous_filename ? [f.previous_filename] : []),
    ]) ?? [];
  const docsOnly =
    paths.length > 0 && paths.every((p) => /\.(md|mdx|rst|txt)$/i.test(p));
  const source = !docsOnly;
  const dependency =
    paths.some((p) =>
      /(?:^|\/)(?:package[^/]*\.json|[^/]*lock[^/]*|requirements[^/]*|go\.(?:mod|sum)|cargo\.(?:toml|lock))$/i.test(
        p,
      ),
    ) || !!context?.risk.includes('dependencies');
  const security =
    dependency ||
    paths.some((p) => /auth|permission|session|crypto|secret/i.test(p)) ||
    !!context?.risk.includes('sensitive-component');
  // Any source/config change can affect runtime performance; narrow path names are insufficient proof otherwise.
  const signals: Record<RunWhen, boolean> = {
    ALWAYS: true,
    SOURCE_CHANGE: source,
    DEPENDENCY_CHANGE: dependency,
    SECURITY_CHANGE: security,
    PERFORMANCE_CHANGE: source,
  };
  const omitted: {
    id: string;
    kind: string;
    runWhen: RunWhen;
    reason: string;
  }[] = [];
  const keep = (check: { id: string; kind?: string; runWhen?: RunWhen }) => {
    const when = check.runWhen ?? 'ALWAYS';
    if (!context || !paths.length || required.has(check.id) || signals[when])
      return true;
    omitted.push({
      id: check.id,
      kind: check.kind ?? 'benchmark',
      runWhen: when,
      reason: docsOnly
        ? 'Documentation-only changed paths do not meet the organizer supplemental applicability rule.'
        : 'Frozen changed paths and trusted risk signals do not meet the organizer supplemental applicability rule.',
    });
    return false;
  };
  const scoped: RunnerPolicy = {
    ...policy,
    commands: policy.commands.filter(keep),
    ...(policy.benchmarks
      ? { benchmarks: policy.benchmarks.filter(keep) }
      : {}),
  };
  const depth =
    !context || !paths.length
      ? 'CONSERVATIVE_ALL'
      : security
        ? 'DEEP'
        : docsOnly
          ? 'LIGHT'
          : 'STANDARD';
  const evidence: Evidence[] = omitted.map((check) => ({
    id: 'execution-routing-' + check.id,
    kind: 'execution',
    status: 'UNVERIFIED',
    claim: `Supplemental ${check.kind} ${check.id} was not executed on baseline or head. Organizer runWhen=${check.runWhen}. ${check.reason} This is not a PASS; all frozen criterion checks and acceptance cases remain required.`,
  }));
  return {
    policy: scoped,
    evidence,
    decision: {
      version: 'supplemental-execution-routing-v1',
      depth,
      docsOnly,
      signals,
      requiredCheckIds: [...required].sort(),
      omitted,
      contextAvailable: !!context,
    },
  };
}

export function frozenExecutionContext(
  raw: unknown,
): FrozenExecutionContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (
    !Array.isArray(value.files) ||
    value.files.length > 1000 ||
    !Array.isArray(value.risk)
  )
    return null;
  const files: FrozenExecutionContext['files'] = [];
  for (const file of value.files) {
    if (!file || typeof file !== 'object') return null;
    const f = file as Record<string, unknown>;
    if (
      typeof f.filename !== 'string' ||
      f.filename.length > 240 ||
      (f.previous_filename !== undefined &&
        typeof f.previous_filename !== 'string')
    )
      return null;
    files.push({
      filename: f.filename,
      ...(typeof f.previous_filename === 'string'
        ? { previous_filename: f.previous_filename }
        : {}),
    });
  }
  return {
    files,
    risk: value.risk.filter(
      (r): r is string =>
        typeof r === 'string' &&
        ['dependencies', 'sensitive-component', 'large-change'].includes(r),
    ),
  };
}
