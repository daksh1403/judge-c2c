import { afterEach, expect, it, vi } from 'vitest';
import { GitHub } from '../src/github';
import { acquirePreparation, releaseReviewer } from '../src/reviewer-capacity';
import { sqliteD1 } from './fixtures/sqlite-d1';
import { migrate } from './database';
afterEach(() => vi.restoreAllMocks());
it.each([429, 403, 200])(
  'respects shared GitHub backoff and quota headers after HTTP %s',
  async (status) => {
    const fixture = sqliteD1();
    let now = Date.now();
    try {
      const db = fixture.db;
      await migrate(db);
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const reset = Math.floor(now / 1000) + 3600;
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response('{}', {
            status,
            headers:
              status === 429
                ? { 'retry-after': '120' }
                : {
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': String(reset),
                  },
          }),
        )
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const client = new GitHub('synthetic', db, db);
      if (status === 200)
        await expect(client.api('/repos/org/repo')).resolves.toEqual({});
      else
        await expect(client.api('/repos/org/repo')).rejects.toThrow(
          'GITHUB_RATE_LIMITED',
        );
      await expect(
        new GitHub('other-synthetic-client', db, db).api('/repos/org/other'),
      ).rejects.toThrow('GITHUB_RATE_LIMITED');
      expect(await acquirePreparation(db)).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      now = status === 429 ? now + 120000 : reset * 1000;
      const slot = await acquirePreparation(db);
      expect(slot).not.toBeNull();
      await releaseReviewer(db, slot!);
      await expect(client.api('/repos/org/repo')).resolves.toEqual({});
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      fixture.close();
    }
  },
);
