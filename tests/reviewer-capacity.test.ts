import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { migrate } from './database';
import {
  acquireReviewer,
  releaseReviewer,
  renewReviewer,
} from '../src/reviewer-capacity';
let mf: Miniflare, db: D1Database;
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default {}',
    d1Databases: ['DB'],
    compatibilityDate: '2026-08-01',
  });
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  await migrate(db);
});
afterAll(() => mf.dispose());
it('serializes competing provider reviews and releases capacity', async () => {
  const slots = await Promise.all([
    acquireReviewer(db, 'callmissed', 1000),
    acquireReviewer(db, 'callmissed', 1000),
  ]);
  expect(slots.filter(Boolean)).toHaveLength(1);
  await releaseReviewer(db, slots.find(Boolean)!);
  const next = await acquireReviewer(db, 'callmissed', 1001);
  expect(next).not.toBeNull();
  await releaseReviewer(db, next!);
});
it('expires crashed ownership and fences stale cleanup', async () => {
  const crashed = await acquireReviewer(db, 'callmissed', 1000);
  expect(crashed).not.toBeNull();
  expect(await acquireReviewer(db, 'callmissed', 180999)).toBeNull();
  const recovered = await acquireReviewer(db, 'callmissed', 181000);
  expect(recovered).not.toBeNull();
  expect(await renewReviewer(db, crashed!, 181001)).toBe(false);
  expect(await renewReviewer(db, recovered!, 181001)).toBe(true);
  await releaseReviewer(db, crashed!);
  expect(await acquireReviewer(db, 'callmissed', 181001)).toBeNull();
  await releaseReviewer(db, recovered!);
});
