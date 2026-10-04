import { runnerResultSchema } from './runner';

// Fixed numeric observations derived from preserved execution/report records.
// Missing measurements remain absent; capacity limits are never actual usage.
export const runMetricNames = [
  'queue.waitMs',
  'stage.fetching.durationMs',
  'stage.checking.durationMs',
  'stage.reviewing.durationMs',
  'stage.synthesizing.durationMs',
  'evaluation.durationMs',
  'evaluation.failure',
  'evaluation.superseded',
  'runner.durationMs',
  'runner.startupMs',
  'runner.cpuUsageUsec',
  'runner.sampledMemoryBytes',
  'runner.sampledPids',
  'ai.finalResponseMicroUsd',
  'cache.context.hit',
  'cache.context.miss',
  'runner.failure',
  'check.install.durationMs',
  'check.scan.durationMs',
  'check.test.durationMs',
  'check.build.durationMs',
  'check.lint.durationMs',
  'check.typecheck.durationMs',
  'check.benchmark.durationMs',
  'ai.durationMs',
  'ai.inputTokens',
  'ai.outputTokens',
  'ai.toolCalls',
  'ai.retries',
  'cache.hit',
  'cache.miss',
  'cache.bypass',
] as const;
type Metric = (typeof runMetricNames)[number];
export async function captureRunMeasurements(db: D1Database, runId: string) {
  if (!/^[a-f0-9]{64}$/.test(runId)) return;
  const run = await db
    .prepare(
      'SELECT state,created_at,updated_at,report,context FROM evaluations WHERE id=?',
    )
    .bind(runId)
    .first<{
      state: string;
      created_at: string;
      updated_at: string;
      report: string | null;
      context: string | null;
    }>();
  if (!run || !['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(run.state))
    return;
  const values = new Map<Metric, number>();
  const add = (name: Metric, value: unknown) => {
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1e12
    )
      values.set(name, (values.get(name) ?? 0) + value);
  };
  const timestamp = (v: string) =>
    Date.parse(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
  add(
    'evaluation.durationMs',
    timestamp(run.updated_at) - timestamp(run.created_at),
  );
  const timeline = (
    await db
      .prepare(
        'SELECT state,created_at FROM timeline WHERE run_id=? ORDER BY id',
      )
      .bind(runId)
      .all<{ state: string; created_at: string }>()
  ).results;
  const stages = timeline.filter(
    (e, i) => i === 0 || timeline[i - 1]?.state !== e.state,
  );
  for (let i = 0; i + 1 < stages.length; i++) {
    const start = stages[i]!,
      end = stages[i + 1]!;
    const name =
      start.state === 'QUEUED'
        ? 'queue.waitMs'
        : `stage.${start.state.toLowerCase()}.durationMs`;
    if (runMetricNames.includes(name as Metric))
      add(
        name as Metric,
        timestamp(end.created_at) - timestamp(start.created_at),
      );
  }
  if (run.state === 'FAILED') add('evaluation.failure', 1);
  if (run.state === 'SUPERSEDED') add('evaluation.superseded', 1);
  try {
    const index = JSON.parse(run.context ?? '{}').repositoryIndexCache;
    if (typeof index?.hit === 'boolean')
      add(index.hit ? 'cache.context.hit' : 'cache.context.miss', 1);
  } catch {
    /* Missing context remains absent. */
  }
  const rows = await db
    .prepare('SELECT result,cache_status FROM execution_results WHERE run_id=?')
    .bind(runId)
    .all<{ result: string; cache_status: string | null }>();
  for (const row of rows.results) {
    if (row.cache_status === 'HIT') {
      add('cache.hit', 1);
      continue;
    }
    add(row.cache_status === 'MISS' ? 'cache.miss' : 'cache.bypass', 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.result);
    } catch {
      continue;
    }
    const result = runnerResultSchema.safeParse(parsed);
    if (!result.success) continue;
    add(
      'runner.durationMs',
      Date.parse(result.data.finishedAt) - Date.parse(result.data.startedAt),
    );
    add('runner.startupMs', result.data.metrics?.startupMs);
    const samples = result.data.metrics?.resources ?? [];
    const scopes = new Map<string, (typeof samples)[number]>();
    for (const sample of samples) {
      const prior = scopes.get(sample.scope);
      scopes.set(
        sample.scope,
        prior
          ? {
              ...sample,
              cpuUsageUsec: Math.max(prior.cpuUsageUsec, sample.cpuUsageUsec),
              memoryBytes: Math.max(prior.memoryBytes, sample.memoryBytes),
              pids: Math.max(prior.pids, sample.pids),
            }
          : sample,
      );
    }
    for (const sample of scopes.values())
      add('runner.cpuUsageUsec', sample.cpuUsageUsec);
    if (samples.length) {
      values.set(
        'runner.sampledMemoryBytes',
        Math.max(
          values.get('runner.sampledMemoryBytes') ?? 0,
          ...samples.map((s) => s.memoryBytes),
        ),
      );
      values.set(
        'runner.sampledPids',
        Math.max(
          values.get('runner.sampledPids') ?? 0,
          ...samples.map((s) => s.pids),
        ),
      );
    }
    if (result.data.checks.some((c) => c.status === 'UNVERIFIED'))
      add('runner.failure', 1);
    for (const check of result.data.checks) {
      const metric =
        check.id === 'dependency-preparation'
          ? 'check.install.durationMs'
          : check.kind === 'security' || check.kind === 'dependency'
            ? 'check.scan.durationMs'
            : `check.${check.kind}.durationMs`;
      if (runMetricNames.includes(metric as Metric))
        add(metric as Metric, check.durationMs);
    }
  }
  let trace: Record<string, unknown> = {};
  try {
    trace = JSON.parse(run.report ?? '{}').aiTrace ?? {};
  } catch {
    /* absent report */
  }
  const cost = trace.cost as { status?: string; microUsd?: number } | undefined;
  if (cost?.status === 'ESTIMATE')
    add('ai.finalResponseMicroUsd', cost.microUsd);
  add('ai.durationMs', trace.durationMs);
  if (typeof trace.attempts === 'number')
    add('ai.retries', Math.max(0, trace.attempts - 1));
  const usage = trace.usage as
    | {
        input_tokens?: number;
        output_tokens?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
      }
    | undefined;
  add('ai.inputTokens', usage?.input_tokens ?? usage?.prompt_tokens);
  add('ai.outputTokens', usage?.output_tokens ?? usage?.completion_tokens);
  const tools =
    (trace.retrieval as { log?: unknown[] } | undefined)?.log ??
    trace.toolCalls;
  if (Array.isArray(tools)) add('ai.toolCalls', tools.length);
  for (const [metric, value] of values)
    await db
      .prepare(
        'INSERT OR IGNORE INTO run_measurements(run_id,metric,value,bucketUtcMinute) VALUES(?,?,?,?)',
      )
      .bind(runId, metric, value, Math.floor(Date.now() / 60000) * 60000)
      .run();
}
export async function readRunMeasurements(
  db: D1Database,
  minutes: number,
  now = Date.now(),
) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)
    throw Error('INVALID_METRICS_WINDOW');
  const bucket = Math.floor(now / 60000) * 60000;
  return (
    await db
      .prepare(
        'SELECT bucketUtcMinute,metric,count(*) AS count,sum(value) AS sum,max(value) AS max FROM run_measurements WHERE bucketUtcMinute>=? AND bucketUtcMinute<=? GROUP BY bucketUtcMinute,metric ORDER BY bucketUtcMinute,metric LIMIT 191520',
      )
      .bind(bucket - (minutes - 1) * 60000, bucket)
      .all()
  ).results;
}

export async function recordRunMeasurement(
  db: D1Database,
  runId: string,
  metric: Metric,
  value: number,
) {
  if (
    !/^[a-f0-9]{64}$/.test(runId) ||
    !runMetricNames.includes(metric) ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1e12
  )
    return;
  await db
    .prepare(
      'INSERT OR IGNORE INTO run_measurements(run_id,metric,value,bucketUtcMinute) VALUES(?,?,?,?)',
    )
    .bind(runId, metric, value, Math.floor(Date.now() / 60000) * 60000)
    .run();
}
