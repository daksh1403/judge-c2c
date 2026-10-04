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
export function releaseReviewer(
  db: D1Database,
  slot: { owner: string; provider: string },
) {
  return db
    .prepare('DELETE FROM reviewer_slots WHERE provider=? AND owner=?')
    .bind(slot.provider, slot.owner)
    .run();
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
