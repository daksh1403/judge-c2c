import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHub } from '../src/github';
import {
  observe,
  readOperationalMetrics,
  expireOperationalMetrics,
  OPERATIONAL_METRICS_RETENTION_MS,
} from '../src/operational-telemetry';

const databases: DatabaseSync[] = [];
function fixture() {
  const sql = new DatabaseSync(':memory:');
  databases.push(sql);
  sql.exec(readFileSync('migrations/0014_operational_telemetry.sql', 'utf8'));
  const db = {
    prepare(query: string) {
      const statement = sql.prepare(query);
      let values: (string | number)[] = [];
      const prepared = {
        bind(...args: (string | number)[]) {
          values = args;
          return prepared;
        },
        async run() {
          return statement.run(...values);
        },
        async all() {
          return { results: statement.all(...values) };
        },
      };
      return prepared;
    },
  } as unknown as D1Database;
  return { db, sql };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const sql of databases.splice(0)) sql.close();
});

describe('operational telemetry aggregates', () => {
  it('aggregates numeric observations in UTC minutes without arbitrary labels', async () => {
    const { db, sql } = fixture();
    await observe(db, 'github.latencyMs', 12, 120_001);
    await observe(db, 'github.latencyMs', 20, 179_999);
    await observe(db, 'github.request', 1, 120_001);
    expect(await readOperationalMetrics(db, 1, 179_999)).toEqual([
      {
        bucketUtcMinute: 120_000,
        metric: 'github.latencyMs',
        count: 2,
        sum: 32,
        max: 20,
      },
      {
        bucketUtcMinute: 120_000,
        metric: 'github.request',
        count: 1,
        sum: 1,
        max: 1,
      },
    ]);
    await observe(db, 'uncontrolled' as never, 1, 120_001);
    await observe(db, 'github.latencyMs', NaN, 120_001);
    await observe(db, 'github.latencyMs', -1, 120_001);
    expect(
      sql.prepare('SELECT count(*) as n FROM operational_metrics').get(),
    ).toMatchObject({ n: 2 });
    expect(() =>
      sql
        .prepare("INSERT INTO operational_metrics VALUES(120000,'token',1,1,1)")
        .run(),
    ).toThrow();
  });
  it('bounds values and read windows and removes expired buckets only in maintenance', async () => {
    const { db } = fixture();
    await observe(db, 'github.latencyMs', 999_999, 0);
    await observe(
      db,
      'github.request',
      1,
      OPERATIONAL_METRICS_RETENTION_MS + 60_000,
    );
    await expireOperationalMetrics(
      db,
      OPERATIONAL_METRICS_RETENTION_MS + 60_000,
    );
    expect(
      await readOperationalMetrics(
        db,
        10_080,
        OPERATIONAL_METRICS_RETENTION_MS + 60_000,
      ),
    ).toHaveLength(1);
    await expect(readOperationalMetrics(db, 10_081)).rejects.toThrow(
      'INVALID_METRICS_WINDOW',
    );
    await expect(readOperationalMetrics(db, 0)).rejects.toThrow(
      'INVALID_METRICS_WINDOW',
    );
  });
  it('swallows unavailable database writes', async () => {
    await expect(observe(undefined, 'github.request')).resolves.toBeUndefined();
    await expect(
      observe(
        {
          prepare() {
            throw Error('database unavailable');
          },
        } as unknown as D1Database,
        'github.request',
      ),
    ).resolves.toBeUndefined();
  });
});

describe('GitHub API observations', () => {
  const failures: [number, string | null, boolean][] = [
    [403, '0', true],
    [403, '2', false],
    [429, null, true],
    [500, null, false],
  ];
  it.each(failures)(
    'preserves HTTP %s failure and detects rate limits from controlled status/header',
    async (status, remaining, limited) => {
      const { db } = fixture();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('private error text', {
            status,
            headers:
              remaining === null ? {} : { 'x-ratelimit-remaining': remaining },
          }),
        ),
      );
      await expect(
        new GitHub('synthetic-token', db).api('/repos/private/repo'),
      ).rejects.toThrow('GITHUB_HTTP_' + status);
      const metrics = await readOperationalMetrics(db);
      expect(
        metrics.find((row) => row.metric === 'github.request')?.count,
      ).toBe(1);
      expect(metrics.find((row) => row.metric === 'github.error')?.count).toBe(
        1,
      );
      expect(metrics.some((row) => row.metric === 'github.rateLimited')).toBe(
        limited,
      );
      expect(JSON.stringify(metrics)).not.toMatch(
        /synthetic-token|private|repo|error text/,
      );
    },
  );
  it('preserves network exception identity even when telemetry fails', async () => {
    const error = Error('network failed');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    const db = {
      prepare() {
        throw Error('database failed');
      },
    } as unknown as D1Database;
    await expect(new GitHub(undefined, db).api('/rate_limit')).rejects.toBe(
      error,
    );
  });
  it('records latency and zero remaining on successful responses without adding errors', async () => {
    const { db } = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"ok":true}', {
          headers: { 'x-ratelimit-remaining': '0' },
        }),
      ),
    );
    expect(await new GitHub(undefined, db).api('/rate_limit')).toEqual({
      ok: true,
    });
    const metrics = await readOperationalMetrics(db);
    expect(
      metrics.find((row) => row.metric === 'github.latencyMs')?.count,
    ).toBe(1);
    expect(
      metrics.find((row) => row.metric === 'github.rateLimited')?.count,
    ).toBe(1);
    expect(metrics.some((row) => row.metric === 'github.error')).toBe(false);
  });
  it('preserves no-content responses, invalid-path rejection and body size limits', async () => {
    const { db } = fixture();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('x'.repeat(2_000_001)));
    vi.stubGlobal('fetch', fetchMock);
    const github = new GitHub(undefined, db);
    await expect(github.api('/empty')).resolves.toBeUndefined();
    await expect(github.api('//invalid')).rejects.toThrow(
      'Invalid GitHub path',
    );
    await expect(github.api('/large')).rejects.toThrow('BODY_LIMIT');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('webhook metric aggregates', () => {
  it('accepts webhook request and error counters and clamps webhook latency', async () => {
    const { db } = fixture();
    await observe(db, 'webhook.request', 1, 120_001);
    await observe(db, 'webhook.error', 1, 120_001);
    await observe(db, 'webhook.latencyMs', 999_999, 120_001);
    expect(await readOperationalMetrics(db, 1, 120_001)).toEqual([
      {
        bucketUtcMinute: 120_000,
        metric: 'webhook.error',
        count: 1,
        sum: 1,
        max: 1,
      },
      {
        bucketUtcMinute: 120_000,
        metric: 'webhook.latencyMs',
        count: 1,
        sum: 120_000,
        max: 120_000,
      },
      {
        bucketUtcMinute: 120_000,
        metric: 'webhook.request',
        count: 1,
        sum: 1,
        max: 1,
      },
    ]);
  });
  it('retains all seven fixed metrics at both ends of a seven day window', async () => {
    const { db } = fixture();
    const metrics = [
      'github.request',
      'github.error',
      'github.rateLimited',
      'github.latencyMs',
      'webhook.request',
      'webhook.error',
      'webhook.latencyMs',
    ] as const;
    for (const metric of metrics) {
      await observe(db, metric, 1, 0);
      await observe(db, metric, 1, OPERATIONAL_METRICS_RETENTION_MS - 60_000);
    }
    expect(
      await readOperationalMetrics(
        db,
        10_080,
        OPERATIONAL_METRICS_RETENTION_MS - 60_000,
      ),
    ).toHaveLength(14);
  });
});
