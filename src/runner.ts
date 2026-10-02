import { z } from 'zod';
import {
  canonical,
  digest,
  pathSchema,
  type Contract,
  type Evidence,
} from './domain';
import {
  runnerPolicySchema,
  RUNNER_VERSION,
  type RunnerPolicy,
} from './runner-policy';
import { GitHub } from './github';
import type { Env } from './env';
import { redact } from './security';
import { tunnelEvaluate } from './runner-tunnel';
export type SourceFile = { path: string; text: string };
export const runnerRequestSchema = z
  .object({
    runId: z.string().regex(/^[a-f0-9]{64}$/),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    contractHash: z.string().regex(/^[a-f0-9]{64}$/),
    policy: runnerPolicySchema,
    timeoutSeconds: z.number().int().min(1).max(600),
    memoryMiB: z.literal(256),
    files: z
      .array(
        z.object({ path: pathSchema, text: z.string().max(100000) }).strict(),
      )
      .max(100),
  })
  .strict();
export type RunnerRequest = z.infer<typeof runnerRequestSchema>;
export const checkResultSchema = z
  .object({
    id: z.string().max(80),
    kind: z.enum(['build', 'test', 'lint', 'acceptance', 'benchmark']),
    status: z.enum(['PASS', 'FAIL', 'UNVERIFIED']),
    exitCode: z.number().int().nullable(),
    durationMs: z.number().int().nonnegative(),
    stdout: z.string().max(65536),
    stderr: z.string().max(65536),
    detail: z.string().max(2000),
  })
  .strict();
export const runnerResultSchema = z
  .object({
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    contractHash: z.string().regex(/^[a-f0-9]{64}$/),
    version: z.literal(RUNNER_VERSION),
    image: z.string().max(500),
    runtime: z.string().max(100),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    checks: z.array(checkResultSchema).max(41),
  })
  .strict();
export type RunnerResult = z.infer<typeof runnerResultSchema>;
export interface RunnerStub {
  evaluate(request: RunnerRequest): Promise<RunnerResult>;
}
export function validateRunnerResult(
  raw: unknown,
  request: RunnerRequest,
  requestHash: string,
) {
  const result = runnerResultSchema.parse(raw);
  if (
    result.requestHash !== requestHash ||
    result.commit !== request.commit ||
    result.contractHash !== request.contractHash ||
    result.image !== request.policy.image
  )
    throw new Error('RUNNER_INPUT_MISMATCH');
  if (Date.parse(result.finishedAt) < Date.parse(result.startedAt))
    throw new Error('RUNNER_TIME_MISMATCH');
  const expected = [
    ...request.policy.commands,
    ...request.policy.cases,
    ...(request.policy.benchmarks ?? []),
  ].map((c) => c.id);
  if (
    result.checks.length !== expected.length ||
    new Set(result.checks.map((c) => c.id)).size !== expected.length ||
    result.checks.some((c) => !expected.includes(c.id))
  )
    throw new Error('RUNNER_CHECK_MISMATCH');
  for (const check of result.checks) {
    const command = request.policy.commands.find((c) => c.id === check.id);
    if (
      check.kind !==
      (command?.kind ??
        (request.policy.benchmarks?.some((b) => b.id === check.id)
          ? 'benchmark'
          : 'acceptance'))
    )
      throw new Error('RUNNER_CHECK_KIND_MISMATCH');
    if (command && check.status === 'PASS' && check.exitCode !== 0)
      throw new Error('RUNNER_FALSE_PASS');
  }
  return result;
}
export async function snapshot(
  github: GitHub,
  c: Contract,
  commit: string,
): Promise<SourceFile[]> {
  const tree = await github.api<{
    truncated: boolean;
    tree: { path: string; type: string; mode: string; size?: number }[];
  }>(`/repos/${c.repository.fullName}/git/trees/${commit}?recursive=1`);
  if (
    tree.truncated ||
    tree.tree.filter((f) => f.type !== 'tree').length > c.execution.maxFiles
  )
    throw new Error('RUNNER_REPOSITORY_LIMIT');
  const files: SourceFile[] = [];
  let total = 0;
  for (const item of tree.tree) {
    if (item.type === 'tree') continue;
    if (item.type !== 'blob' || !['100644', '100755'].includes(item.mode))
      throw new Error('RUNNER_UNSAFE_TREE');
    if ((item.size ?? 0) > c.execution.maxFileBytes)
      throw new Error('RUNNER_FILE_LIMIT');
    const text = await github.file(
      c.repository.fullName,
      commit,
      item.path,
      c.execution.maxFileBytes,
    );
    if (text === null) throw new Error('RUNNER_SOURCE_UNAVAILABLE');
    total += new TextEncoder().encode(text).length;
    if (total > 750000) throw new Error('RUNNER_SNAPSHOT_LIMIT');
    files.push({ path: item.path, text });
  }
  return files;
}
export function executionEvidence(
  c: Contract,
  baseline: RunnerResult,
  head: RunnerResult,
): Evidence[] {
  return c.requirements.flatMap((r) =>
    r.criteria.flatMap((criterion) => {
      if (criterion.verification.type !== 'runner') return [];
      const id = criterion.verification.checkId;
      const result = head.checks.find((x) => x.id === id),
        before = baseline.checks.find((x) => x.id === id);
      // Participant-authored test commands are supplemental, never acceptance proof.
      const trusted =
        result?.kind === 'acceptance' || result?.kind === 'benchmark';
      return [
        {
          id: 'criterion-' + criterion.id,
          kind: 'execution' as const,
          criterionId: criterion.id,
          status: trusted ? result.status : ('UNVERIFIED' as const),
          baselineStatus:
            before?.kind === 'acceptance' || before?.kind === 'benchmark'
              ? before.status
              : ('UNVERIFIED' as const),
          claim: trusted
            ? `${result.detail} Baseline ${before?.status ?? 'UNVERIFIED'} → submission ${result.status}.`
            : 'No trusted acceptance evidence for this functional criterion.',
        },
      ];
    }),
  );
}
export async function runObjective(
  env: Env,
  run: { id: string; head_sha: string; contract_hash: string },
  c: Contract,
  evidence: Evidence[],
) {
  if (!c.execution.runner) return evidence;
  const policy = c.execution.runner;
  if ((!env.RUNNER && !env.RUNNER_ENDPOINT) || env.RUNNER_ENABLED !== 'true')
    return evidence.map((e) =>
      e.criterionId &&
      c.requirements.some((r) =>
        r.criteria.some(
          (a) => a.id === e.criterionId && a.verification.type === 'runner',
        ),
      )
        ? {
            ...e,
            claim: 'Isolated execution is disabled. No tests have run.',
            status: 'UNVERIFIED' as const,
          }
        : e,
    );
  const github = await GitHub.installation(env, c);
  const results: RunnerResult[] = [];
  for (const commit of [c.baseline, run.head_sha]) {
    const current = await env.DB.prepare(
      'SELECT e.state,s.latest_run_id FROM evaluations e JOIN submissions s ON s.repository_id=e.repository_id AND s.pr_number=e.pr_number WHERE e.id=?',
    )
      .bind(run.id)
      .first<{ state: string; latest_run_id: string }>();
    if (
      !current ||
      current.latest_run_id !== run.id ||
      current.state === 'SUPERSEDED'
    )
      throw new Error('RUNNER_SUPERSEDED');
    const request: RunnerRequest = {
      runId: run.id,
      commit,
      contractHash: run.contract_hash,
      policy,
      timeoutSeconds: c.execution.timeoutSeconds,
      memoryMiB: 256,
      files: await snapshot(github, c, commit),
    };
    const hash = await digest(canonical(request));
    // Each adapter restores a fresh guest snapshot for every baseline/head attempt.
    const stub = env.RUNNER?.get(
      env.RUNNER!.idFromName(run.id + '-' + commit + '-' + crypto.randomUUID()),
    ) as unknown as RunnerStub;
    const result = validateRunnerResult(
      env.RUNNER_ENDPOINT
        ? await tunnelEvaluate(env, request)
        : await stub.evaluate(request),
      request,
      hash,
    );
    const stored = redact(canonical(result));
    await env.DB.prepare(
      'INSERT INTO execution_results(id,run_id,commit_sha,request_hash,result_hash,result) VALUES(?,?,?,?,?,?)',
    )
      .bind(
        crypto.randomUUID(),
        run.id,
        commit,
        hash,
        await digest(stored),
        stored,
      )
      .run();
    results.push(result);
  }
  const replacement = executionEvidence(c, results[0]!, results[1]!);
  const all = [
    ...evidence.filter((e) => !replacement.some((r) => r.id === e.id)),
    ...replacement,
  ];
  for (const check of results[1]!.checks.filter(
    (x) => x.kind !== 'acceptance',
  )) {
    const before = results[0]!.checks.find((x) => x.id === check.id);
    all.push({
      id: 'execution-' + check.id,
      kind: 'execution',
      status: check.status,
      baselineStatus: before?.status,
      claim: `${check.kind}: ${check.detail} Baseline ${before?.status ?? 'UNVERIFIED'} → submission ${check.status}. ${check.kind === 'benchmark' ? 'Trusted, environment-specific HTTP benchmark.' : 'Repository commands are supplemental evidence.'}`,
    });
  }
  return all;
}
