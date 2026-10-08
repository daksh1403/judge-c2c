import { actionsEvaluate, frozenActionsInput } from './actions-runner';
import {
  acquirePreparation,
  releaseReviewer,
  renewReviewer,
} from './reviewer-capacity';
import { routeExecution, frozenExecutionContext } from './execution-routing';
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
  commandKinds,
  RUNNER_VERSION,
  type RunnerPolicy,
} from './runner-policy';
import { GitHub } from './github';
import type { Env } from './env';
import { redact } from './security';
import { tunnelEvaluate } from './runner-tunnel';
import {
  cacheableResult,
  executionCacheKey,
  safeRunnerRequest,
  verifiedCacheEntry,
} from './execution-cache';
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
export type RunnerRequest = z.input<typeof runnerRequestSchema>;
export const checkResultSchema = z
  .object({
    id: z.string().max(80),
    kind: z.enum([...commandKinds, 'acceptance', 'benchmark']),
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
    metrics: z
      .object({
        startupMs: z.number().int().nonnegative().max(600000).optional(),
        tools: z
          .object({
            node: z.string().regex(/^v\d+\.\d+\.\d+$/),
            npm: z.string().regex(/^\d+\.\d+\.\d+$/),
          })
          .strict()
          .optional(),
        resources: z
          .array(
            z
              .object({
                scope: z.string().max(100),
                sampledAt: z.string().datetime(),
                cpuUsageUsec: z.number().int().nonnegative().max(1e12),
                memoryBytes: z.number().int().nonnegative().max(1e12),
                pids: z.number().int().nonnegative().max(100000),
              })
              .strict(),
          )
          .max(9),
      })
      .strict()
      .optional(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    checks: z.array(checkResultSchema).max(42),
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
  if (result.metrics) {
    const scopes = [
      'service',
      ...request.policy.commands.map((c) => 'command:' + c.id),
    ];
    const resources = result.metrics.resources;
    if (
      new Set(resources.map((s) => s.scope)).size !== resources.length ||
      resources.some(
        (s) =>
          !scopes.includes(s.scope) ||
          Date.parse(s.sampledAt) < Date.parse(result.startedAt) ||
          Date.parse(s.sampledAt) > Date.parse(result.finishedAt),
      ) ||
      (result.metrics.startupMs ?? 0) >
        Date.parse(result.finishedAt) - Date.parse(result.startedAt)
    )
      throw new Error('RUNNER_METRICS_MISMATCH');
  }
  const expected = [
    ...request.policy.commands,
    ...request.policy.cases,
    ...(request.policy.benchmarks ?? []),
  ].map((c) => c.id);
  if (request.policy.dependencies) expected.push('dependency-preparation');
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
        (request.policy.dependencies && check.id === 'dependency-preparation'
          ? 'dependency'
          : request.policy.benchmarks?.some((b) => b.id === check.id)
            ? 'benchmark'
            : 'acceptance'))
    )
      throw new Error('RUNNER_CHECK_KIND_MISMATCH');
    if (
      (command || check.kind === 'dependency') &&
      check.status === 'PASS' &&
      check.exitCode !== 0
    )
      throw new Error('RUNNER_FALSE_PASS');
  }
  return result;
}
export async function snapshot(
  github: GitHub,
  c: Contract,
  commit: string,
  assertCurrent: () => Promise<void> = async () => {},
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
    await assertCurrent();
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
  options: { deferActions?: boolean } = {},
) {
  if (!c.execution.runner) return evidence;
  const originalPolicy = c.execution.runner;
  if (
    (!env.RUNNER &&
      !env.RUNNER_ENDPOINT &&
      env.RUNNER_BACKEND !== 'actions-vm') ||
    env.RUNNER_ENABLED !== 'true'
  )
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
  const frozen = await env.DB.prepare(
    'SELECT context,head_sha,baseline_sha,contract_hash FROM evaluations WHERE id=?',
  )
    .bind(run.id)
    .first<{
      context: string | null;
      head_sha: string;
      baseline_sha: string;
      contract_hash: string;
    }>();
  let context: ReturnType<typeof frozenExecutionContext> = null;
  if (
    frozen?.context &&
    frozen.head_sha === run.head_sha &&
    frozen.baseline_sha === c.baseline &&
    frozen.contract_hash === run.contract_hash
  ) {
    try {
      context = frozenExecutionContext(JSON.parse(frozen.context));
    } catch {
      /* Missing or invalid context preserves every check. */
    }
  }
  const routing = routeExecution(c, originalPolicy, context);
  const policy = routing.policy;
  let github: GitHub | undefined;
  const results: RunnerResult[] = [];
  const repositoryId = c.repository.id;
  const cachePolicy = policy.cache ?? 'NONE';
  const hasBenchmarks = (policy.benchmarks?.length ?? 0) > 0;
  const cacheAllowed = cachePolicy !== 'NONE' && !hasBenchmarks;
  const provenance: {
    cacheStatus: 'BYPASS' | 'MISS' | 'HIT';
    originRunId: string;
    originExecutionId: string;
    cacheKey: string;
  }[] = [];
  const assertCurrent = async () => {
    const current = await env.DB.prepare(
      'SELECT e.state,e.repository_id,s.latest_run_id,s.head_sha,s.closed FROM evaluations e JOIN submissions s ON s.repository_id=e.repository_id AND s.pr_number=e.pr_number WHERE e.id=?',
    )
      .bind(run.id)
      .first<{
        state: string;
        repository_id: number;
        latest_run_id: string;
        head_sha: string;
        closed: number;
      }>();
    if (
      !current ||
      current.repository_id !== repositoryId ||
      current.latest_run_id !== run.id ||
      current.head_sha !== run.head_sha ||
      current.closed !== 0 ||
      current.state !== 'CHECKING'
    )
      throw new Error('RUNNER_SUPERSEDED');
  };
  let sourceSlot: Awaited<ReturnType<typeof acquirePreparation>> = null;
  try {
    for (const commit of [c.baseline, run.head_sha]) {
      await assertCurrent();
      const descriptor: Omit<RunnerRequest, 'files'> = {
        runId: run.id,
        commit,
        contractHash: run.contract_hash,
        policy,
        timeoutSeconds: c.execution.timeoutSeconds,
        memoryMiB: 256,
      };
      const frozenInput =
        options.deferActions && env.RUNNER_BACKEND === 'actions-vm'
          ? await frozenActionsInput(env, descriptor)
          : null;
      if (options.deferActions && !frozenInput && !sourceSlot) {
        sourceSlot = await acquirePreparation(env.CAPACITY_DB ?? env.DB);
        if (!sourceSlot) throw new Error('RUNNER_BUSY');
      }
      const request: RunnerRequest = frozenInput ?? {
        ...descriptor,
        files: await snapshot(
          (github ??= await GitHub.installation(env, c)),
          c,
          commit,
          async () => {
            await assertCurrent();
            if (
              sourceSlot &&
              !(await renewReviewer(env.CAPACITY_DB ?? env.DB, sourceSlot))
            )
              throw new Error('PREPARATION_LEASE_EXPIRED');
          },
        ),
      };
      const hash = await digest(canonical(request));
      const adapter =
        env.RUNNER_BACKEND === 'actions-vm'
          ? 'actions-vm'
          : env.RUNNER_ENDPOINT
            ? 'signed-tunnel'
            : 'durable-object';
      const imageDigest = [policy.image, env.RUNNER_IMAGE_URI ?? ''].join('|');
      const key = await executionCacheKey(
        repositoryId,
        request,
        adapter,
        env.ENVIRONMENT,
        imageDigest,
      );
      // Durable polling resumes this same evaluation, not a new retry run. Reuse
      // its already authenticated completed baseline without executing or storing
      // it again while the submission attempt is still queued.
      if (options.deferActions && frozenInput) {
        const previous = await env.DB.prepare(
          'SELECT id,result,result_hash,cache_status,cache_key FROM execution_results WHERE run_id=? AND commit_sha=? AND request_hash=? ORDER BY rowid DESC LIMIT 1',
        )
          .bind(run.id, commit, hash)
          .first<{
            id: string;
            result: string;
            result_hash: string;
            cache_status: 'BYPASS' | 'MISS' | 'HIT';
            cache_key: string;
          }>();
        if (previous) {
          if ((await digest(previous.result)) !== previous.result_hash)
            throw new Error('RUNNER_RESULT_INTEGRITY');
          results.push(
            validateRunnerResult(JSON.parse(previous.result), request, hash),
          );
          provenance.push({
            cacheStatus: previous.cache_status,
            originRunId: run.id,
            originExecutionId: previous.id,
            cacheKey: previous.cache_key,
          });
          continue;
        }
      }
      const mayRead =
        cacheAllowed && (cachePolicy === 'ALL' || commit === c.baseline);
      if (mayRead) {
        const cached = await env.DB.prepare(
          'SELECT ec.repository_id,ec.cache_key,ec.origin_run_id,ec.origin_execution_id,ec.request_hash,ec.result_hash,ec.request,ec.result,origin.repository_id AS verified_repository_id,er.run_id AS verified_origin_run_id,er.request_hash AS verified_request_hash,er.result_hash AS verified_result_hash,er.request AS verified_request,er.result AS verified_result,er.created_at AS verified_origin_created_at FROM execution_cache ec JOIN evaluations origin ON origin.id=ec.origin_run_id AND origin.repository_id=ec.repository_id JOIN execution_results er ON er.id=ec.origin_execution_id AND er.run_id=ec.origin_run_id WHERE ec.repository_id=? AND ec.cache_key=?',
        )
          .bind(repositoryId, key)
          .first<{
            repository_id: number;
            cache_key: string;
            origin_run_id: string;
            origin_execution_id: string;
            request_hash: string;
            result_hash: string;
            request: string;
            result: string;
            verified_repository_id: number;
            verified_origin_run_id: string;
            verified_request_hash: string;
            verified_result_hash: string;
            verified_request: string;
            verified_result: string;
            verified_origin_created_at: string;
          }>();
        if (cached) {
          const reused = await verifiedCacheEntry(
            cached,
            key,
            request,
            validateRunnerResult,
          );
          if (
            reused &&
            /^[0-9a-f-]{36}$/i.test(cached.origin_execution_id) &&
            /^[a-f0-9]{64}$/.test(cached.origin_run_id) &&
            cached.verified_repository_id === repositoryId &&
            cached.origin_run_id === cached.verified_origin_run_id &&
            JSON.parse(cached.request).runId === cached.origin_run_id &&
            cached.request_hash === cached.verified_request_hash &&
            cached.result_hash === cached.verified_result_hash &&
            cached.request === cached.verified_request &&
            cached.result === cached.verified_result
          ) {
            await assertCurrent();
            await env.DB.prepare(
              'INSERT INTO execution_results(id,run_id,commit_sha,request_hash,result_hash,result,request,origin_run_id,origin_execution_id,cache_key,cache_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            )
              .bind(
                crypto.randomUUID(),
                run.id,
                commit,
                cached.request_hash,
                cached.result_hash,
                cached.result,
                cached.request,
                cached.origin_run_id,
                cached.origin_execution_id,
                key,
                'HIT',
                cached.verified_origin_created_at,
              )
              .run();
            results.push(reused);
            provenance.push({
              cacheStatus: 'HIT',
              originRunId: cached.origin_run_id,
              originExecutionId: cached.origin_execution_id,
              cacheKey: key,
            });
            continue;
          }
        }
      }
      await assertCurrent();
      // Each adapter restores a fresh guest snapshot for every baseline/head attempt.
      const stub = env.RUNNER?.get(
        env.RUNNER!.idFromName(
          run.id + '-' + commit + '-' + crypto.randomUUID(),
        ),
      ) as unknown as RunnerStub;
      const authenticated = validateRunnerResult(
        env.RUNNER_BACKEND === 'actions-vm'
          ? await actionsEvaluate(env, request, false, assertCurrent, {
              defer: options.deferActions,
            })
          : env.RUNNER_ENDPOINT
            ? await tunnelEvaluate(env, request)
            : await stub.evaluate(request),
        request,
        hash,
      );
      const original = canonical(authenticated);
      const stored = redact(original);
      const result = runnerResultSchema.parse(JSON.parse(stored));
      const requestSummary = canonical(await safeRunnerRequest(request));
      const canStore =
        cacheAllowed &&
        cacheableResult(authenticated, stored, request.timeoutSeconds);
      const attemptStatus = canStore ? 'MISS' : 'BYPASS';
      const executionId = crypto.randomUUID();
      const resultHash = await digest(stored);
      await env.DB.prepare(
        'INSERT INTO execution_results(id,run_id,commit_sha,request_hash,result_hash,result,request,cache_key,cache_status) VALUES(?,?,?,?,?,?,?,?,?)',
      )
        .bind(
          executionId,
          run.id,
          commit,
          hash,
          resultHash,
          stored,
          requestSummary,
          key,
          attemptStatus,
        )
        .run();
      // Dispatched execution cannot be recalled. Keep its authenticated, redacted
      // result on the immutable attempt before fencing every subsequent action.
      await assertCurrent();
      if (canStore) {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO execution_cache(repository_id,cache_key,origin_run_id,origin_execution_id,request_hash,result_hash,request,result) SELECT ?,?,?,?,?,?,?,? FROM evaluations e JOIN submissions s ON s.repository_id=e.repository_id AND s.pr_number=e.pr_number WHERE e.id=? AND e.state='CHECKING' AND s.latest_run_id=e.id AND s.head_sha=e.head_sha AND s.closed=0",
        )
          .bind(
            repositoryId,
            key,
            run.id,
            executionId,
            hash,
            resultHash,
            requestSummary,
            stored,
            run.id,
          )
          .run();
      }
      results.push(result);
      provenance.push({
        cacheStatus: attemptStatus,
        originRunId: run.id,
        originExecutionId: executionId,
        cacheKey: key,
      });
    }
    const replacement = executionEvidence(c, results[0]!, results[1]!).map(
      (item) => ({
        ...item,
        claim: `${item.claim} Execution provenance: baseline ${provenance[0]?.cacheStatus ?? 'BYPASS'} from run ${provenance[0]?.originRunId ?? run.id}, execution ${provenance[0]?.originExecutionId ?? 'unavailable'}, cache ${provenance[0]?.cacheKey ?? 'unavailable'}; submission ${provenance[1]?.cacheStatus ?? 'BYPASS'} from run ${provenance[1]?.originRunId ?? run.id}, execution ${provenance[1]?.originExecutionId ?? 'unavailable'}, cache ${provenance[1]?.cacheKey ?? 'unavailable'}.`,
      }),
    );
    const all = [
      ...evidence.filter((e) => !replacement.some((r) => r.id === e.id)),
      ...replacement,
      ...routing.evidence,
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
  } finally {
    if (sourceSlot)
      await releaseReviewer(env.CAPACITY_DB ?? env.DB, sourceSlot);
  }
}
