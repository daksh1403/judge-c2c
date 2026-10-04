// Bounded retrospective wall-time observations, not production capacity claims.
const timedStates = [
  'QUEUED',
  'FETCHING',
  'CHECKING',
  'REVIEWING',
  'SYNTHESIZING',
] as const;
type TimedState = (typeof timedStates)[number];
export async function evaluationMetrics(db: D1Database) {
  const rows = await db
    .prepare(
      `WITH recent AS (
    SELECT id FROM evaluations ORDER BY created_at DESC,id LIMIT 100
  ) SELECT t.id,t.run_id,t.state,t.created_at FROM timeline t
    JOIN recent r ON r.id=t.run_id ORDER BY t.id DESC LIMIT 5001`,
    )
    .all<{ id: number; run_id: string; state: string; created_at: string }>();
  const truncated = rows.results.length > 5000;
  const intervals = new Map<TimedState, number[]>(
    timedStates.map((s) => [s, []]),
  );
  const grouped = new Map<string, typeof rows.results>();
  for (const row of rows.results.slice(0, 5000).reverse()) {
    const group = grouped.get(row.run_id) ?? [];
    group.push(row);
    grouped.set(row.run_id, group);
  }
  for (const events of grouped.values()) {
    // Preserve the first entry of consecutive detail records for one stage.
    const transitions = events.filter(
      (event, index) => index === 0 || events[index - 1]!.state !== event.state,
    );
    for (
      let index = truncated ? 1 : 0;
      index + 1 < transitions.length;
      index++
    ) {
      const start = transitions[index]!,
        end = transitions[index + 1]!;
      const bucket = intervals.get(start.state as TimedState);
      if (!bucket) continue;
      const timestamp = (value: string) =>
        Date.parse(
          /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
            ? value.replace(' ', 'T') + 'Z'
            : value,
        );
      const duration = timestamp(end.created_at) - timestamp(start.created_at);
      if (Number.isFinite(duration) && duration >= 0) bucket.push(duration);
    }
  }
  return {
    sampledRuns: grouped.size,
    maxRuns: 100,
    maxTransitions: 5000,
    truncated,
    stages: Object.fromEntries(
      [...intervals].map(([state, values]) => [
        state,
        {
          samples: values.length,
          meanMs: values.length
            ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
            : null,
          maxMs: values.length ? Math.max(...values) : null,
        },
      ]),
    ),
  };
}
