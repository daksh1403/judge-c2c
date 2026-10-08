// Bound expensive provider concurrency independently from participant execution.
// Calls are limited to two65-second attempts; the three-minute lease also expires
// after a worker crash. Ownership fencing prevents stale releases affecting reuse.
export async function acquireReviewer(
  db: D1Database,
  provider: string,
  now = Date.now(),
) {
  const owner = crypto.randomUUID();
  const result = await db
    .prepare(
      'INSERT INTO reviewer_slots(provider,owner,lease_until) VALUES(?,?,?) ON CONFLICT(provider) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until WHERE reviewer_slots.lease_until<=?',
    )
    .bind(provider, owner, now + 180000, now)
    .run();
  if (!result.meta.changes) return null;
  return { owner, provider };
}

// Four preparation leases bound aggregate GitHub fan-out across submissions.
// The caller renews during source fetches and releases within its durable step.
export async function acquirePreparation(db: D1Database, now = Date.now()) {
  if (await githubBackoffActive(db, now)) return null;
  for (let index = 0; index < 4; index++) {
    const slot = await acquireReviewer(db, `github-preparation:${index}`, now);
    if (slot) return slot;
  }
  return null;
}

export async function githubBackoffActive(db: D1Database, now = Date.now()) {
  const row = await db
    .prepare(
      "SELECT lease_until FROM reviewer_slots WHERE provider='github-api-cooldown' AND lease_until>?",
    )
    .bind(now)
    .first<{ lease_until: number }>();
  return !!row;
}

export async function recordGitHubBackoff(db: D1Database, headers: Headers) {
  const now = Date.now();
  const retry = Number(headers.get('retry-after'));
  const reset =
    headers.get('x-ratelimit-remaining') === '0'
      ? Number(headers.get('x-ratelimit-reset')) * 1000
      : 0;
  const retryAt =
    Number.isFinite(retry) && retry > 0
      ? now + retry * 1000
      : Date.parse(headers.get('retry-after') ?? '');
  const until = Math.min(
    now + 86400000,
    Math.max(
      now + 60000,
      Number.isFinite(retryAt) ? retryAt : 0,
      Number.isFinite(reset) ? reset : 0,
    ),
  );
  await db
    .prepare(
      "INSERT INTO reviewer_slots(provider,owner,lease_until) VALUES('github-api-cooldown',?,?) ON CONFLICT(provider) DO UPDATE SET owner=excluded.owner,lease_until=MAX(reviewer_slots.lease_until,excluded.lease_until)",
    )
    .bind(crypto.randomUUID(), until)
    .run();
}
export function releaseReviewer(
  db: D1Database,
  slot: { owner: string; provider: string },
) {
  return db
    .prepare('DELETE FROM reviewer_slots WHERE provider=? AND owner=?')
    .bind(slot.provider, slot.owner)
    .run();
}

export async function coolDownReviewer(
  db: D1Database,
  slot: { owner: string; provider: string },
  delayMs: number,
) {
  const result = await db
    .prepare(
      'UPDATE reviewer_slots SET lease_until=? WHERE provider=? AND owner=?',
    )
    .bind(
      Date.now() + Math.min(300000, Math.max(30000, delayMs)),
      slot.provider,
      slot.owner,
    )
    .run();
  return result.meta.changes > 0;
}
// Durable steps may resume late. Recheck ownership immediately before API use.
export async function renewReviewer(
  db: D1Database,
  slot: { owner: string; provider: string },
  now = Date.now(),
) {
  const result = await db
    .prepare(
      'UPDATE reviewer_slots SET lease_until=? WHERE provider=? AND owner=? AND lease_until>?',
    )
    .bind(now + 180000, slot.provider, slot.owner, now)
    .run();
  return result.meta.changes > 0;
}
