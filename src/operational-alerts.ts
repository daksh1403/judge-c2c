type Bucket = { metric: string; count: number; sum: number; max: number };
/** Bounded dashboard signals from recorded observations, not service-health certification. */
export function operationalAlerts(buckets: Bucket[]) {
  const totals = new Map<string, number>();
  for (const row of buckets)
    totals.set(row.metric, (totals.get(row.metric) ?? 0) + row.sum);
  const actions: Record<string, { title: string; action: string }> = {
    'github.error': {
      title: 'GitHub requests failed',
      action:
        'Inspect synchronization/check publication state and retry after service recovery.',
    },
    'github.rateLimited': {
      title: 'GitHub rate limits observed',
      action:
        'Inspect retry/backpressure state; preserve current heads while requests wait.',
    },
    'webhook.error': {
      title: 'Webhook processing errors observed',
      action:
        'Inspect durable inbox/outbox recovery and ensure failed deliveries remain retryable.',
    },
    'evaluation.failure': {
      title: 'Evaluation stages failed',
      action:
        'Open failed runs and inspect preserved evidence before retrying as new attempts.',
    },
    'runner.failure': {
      title: 'Runner verification unavailable',
      action:
        'Inspect preparation/check failures and recover isolated execution capacity.',
    },
    'ai.retries': {
      title: 'AI review needed recovery',
      action:
        'Inspect provider/validation traces and unresolved qualitative analysis; objective results remain authoritative.',
    },
  };
  return Object.entries(actions)
    .filter(([name]) => (totals.get(name) ?? 0) > 0)
    .map(([metric, details]) => ({
      metric,
      observed: totals.get(metric),
      ...details,
    }));
}
