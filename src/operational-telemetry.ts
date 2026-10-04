export const operationalMetrics = [
  'github.request',
  'github.error',
  'github.rateLimited',
  'github.latencyMs',
  'webhook.request',
  'webhook.error',
  'webhook.latencyMs',
] as const;
export type OperationalMetric = (typeof operationalMetrics)[number];
export const OPERATIONAL_METRICS_RETENTION_MS = 7 * 24 * 60 * 60_000;
export type OperationalMetricBucket = {
  bucketUtcMinute: number;
  metric: OperationalMetric;
  count: number;
  sum: number;
  max: number;
};

/** Best effort, fixed-cardinality numeric observations. Never accepts request data. */
export async function observe(
  db: D1Database | undefined,
  metric: OperationalMetric,
  value = 1,
  now = Date.now(),
): Promise<void> {
  if (
    !db ||
    !operationalMetrics.includes(metric) ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    return;
  const boundedValue = metric.endsWith('.latencyMs')
    ? Math.min(value, 120_000)
    : 1;
  try {
    await db
      .prepare(
        'INSERT INTO operational_metrics(bucketUtcMinute,metric,count,sum,max) VALUES(?,?,1,?,?) ON CONFLICT(bucketUtcMinute,metric) DO UPDATE SET count=count+1,sum=sum+excluded.sum,max=max(max,excluded.max)',
      )
      .bind(
        Math.floor(now / 60_000) * 60_000,
        metric,
        boundedValue,
        boundedValue,
      )
      .run();
  } catch {
    // Missing migrations or telemetry outages must preserve request outcomes.
  }
}

export async function readOperationalMetrics(
  db: D1Database,
  minutes = 60,
  now = Date.now(),
): Promise<OperationalMetricBucket[]> {
  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 10_080 ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw Error('INVALID_METRICS_WINDOW');
  const bucket = Math.floor(now / 60_000) * 60_000;
  return (
    await db
      .prepare(
        'SELECT bucketUtcMinute,metric,count,sum,max FROM operational_metrics WHERE bucketUtcMinute>=? AND bucketUtcMinute<=? ORDER BY bucketUtcMinute,metric LIMIT 70560',
      )
      .bind(bucket - (minutes - 1) * 60_000, bucket)
      .all<OperationalMetricBucket>()
  ).results;
}

/** Run from scheduled maintenance, never from the request path. */
export async function expireOperationalMetrics(
  db: D1Database,
  now = Date.now(),
): Promise<void> {
  if (!Number.isSafeInteger(now) || now < 0) return;
  try {
    await db
      .prepare('DELETE FROM run_measurements WHERE bucketUtcMinute<=?')
      .bind(
        Math.floor(now / 60_000) * 60_000 - OPERATIONAL_METRICS_RETENTION_MS,
      )
      .run();
  } catch {
    /* Older deployments or telemetry outages must not block maintenance. */
  }
  await db
    .prepare('DELETE FROM operational_metrics WHERE bucketUtcMinute<=?')
    .bind(Math.floor(now / 60_000) * 60_000 - OPERATIONAL_METRICS_RETENTION_MS)
    .run();
}
