import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonical, digest } from '../src/domain';
import {
  cacheableResult,
  executionCacheKey,
  safeRunnerRequest,
  verifiedCacheEntry,
} from '../src/execution-cache';
import {
  validateRunnerResult,
  type RunnerRequest,
  type RunnerResult,
} from '../src/runner';
import { paymentRetryPolicy, RUNNER_VERSION } from '../src/runner-policy';

const originRunId = 'a'.repeat(64);
const head = 'b'.repeat(40);
const contractHash = 'c'.repeat(64);
const policy = {
  ...paymentRetryPolicy,
  cache: 'ALL' as const,
  image: 'registry.cloudflare.com/account/node@sha256:' + 'd'.repeat(64),
};
const request: RunnerRequest = {
  runId: originRunId,
  commit: head,
  contractHash,
  policy,
  timeoutSeconds: 60,
  memoryMiB: 256,
  files: [{ path: 'server.mjs', text: 'export default 1;' }],
};

function resultFor(value: RunnerRequest): RunnerResult {
  return {
    requestHash: '',
    commit: value.commit,
    contractHash: value.contractHash,
    version: RUNNER_VERSION,
    image: value.policy.image,
    runtime: 'v24.0.0',
    startedAt: '2026-10-02T00:00:00.000Z',
    finishedAt: '2026-10-02T00:00:01.000Z',
    checks: [
      ...value.policy.commands.map((command) => ({
        id: command.id,
        kind: command.kind,
        status: 'PASS' as const,
        exitCode: 0,
        durationMs: 1,
        stdout: '',
        stderr: '',
        detail: 'Completed.',
      })),
      ...value.policy.cases.map((test) => ({
        id: test.id,
        kind: 'acceptance' as const,
        status: 'PASS' as const,
        exitCode: null,
        durationMs: 1,
        stdout: '',
        stderr: '',
        detail: 'Verified.',
      })),
    ],
  };
}

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE repositories(id INTEGER PRIMARY KEY);
    CREATE TABLE evaluations(id TEXT PRIMARY KEY,repository_id INTEGER NOT NULL REFERENCES repositories(id));
    CREATE TABLE execution_results(
      id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES evaluations(id),commit_sha TEXT NOT NULL,
      request_hash TEXT NOT NULL,result_hash TEXT NOT NULL,result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  sql.exec(readFileSync('migrations/0011_execution_cache.sql', 'utf8'));
  sql.prepare('INSERT INTO repositories(id) VALUES(?),(?)').run(1, 2);
  sql
    .prepare('INSERT INTO evaluations(id,repository_id) VALUES(?,1),(?,2)')
    .run(originRunId, 'e'.repeat(64));
  const DB = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) {
          values = args;
          return statement;
        },
        async run() {
          const output = sql.prepare(query).run(...(values as never[]));
          return { meta: { changes: Number(output.changes) } };
        },
        async first<T>() {
          return (
            (sql.prepare(query).get(...(values as never[])) as T | undefined) ??
            null
          );
        },
        async all<T>() {
          const rows = sql.prepare(query).all(...(values as never[]));
          return { results: rows as T[] };
        },
      };
      return statement;
    },
  };
  return { sql, DB };
}

async function originRecord(f: ReturnType<typeof fixture>) {
  const originalRequest = structuredClone(request);
  const requestHash = await digest(canonical(originalRequest));
  const result = resultFor(originalRequest);
  result.requestHash = requestHash;
  const resultText = canonical(result);
  const resultHash = await digest(resultText);
  const requestText = canonical(await safeRunnerRequest(originalRequest));
  const executionId = '11111111-1111-4111-8111-111111111111';
  f.sql
    .prepare(
      'INSERT INTO execution_results(id,run_id,commit_sha,request_hash,result_hash,result,request) VALUES(?,?,?,?,?,?,?)',
    )
    .run(
      executionId,
      originRunId,
      head,
      requestHash,
      resultHash,
      resultText,
      requestText,
    );
  return {
    executionId,
    requestHash,
    resultHash,
    resultText,
    requestText,
    result,
  };
}

describe('execution cache SQLite policy', () => {
  it('applies migration metadata and enforces the cache status check', async () => {
    const f = fixture();
    const columns = (
      await f.DB.prepare('PRAGMA table_info(execution_results)').all<{
        name: string;
      }>()
    ).results;
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'request',
        'origin_run_id',
        'origin_execution_id',
        'cache_key',
        'cache_status',
      ]),
    );
    await expect(
      f.DB.prepare(
        "INSERT INTO execution_results(id,run_id,commit_sha,request_hash,result_hash,result,cache_status) VALUES('x',?,'h','h','h','{}','INVALID')",
      )
        .bind(originRunId)
        .run(),
    ).rejects.toThrow();
  });

  it('changes cache identity when repository, source, commit, contract, policy, runtime settings or resources change', async () => {
    const key = await executionCacheKey(
      1,
      request,
      'signed-tunnel',
      'review',
      'image-digest',
    );
    const changed = [
      executionCacheKey(2, request, 'signed-tunnel', 'review', 'image-digest'),
      executionCacheKey(
        1,
        {
          ...request,
          files: [{ path: 'server.mjs', text: 'export default 2;' }],
        },
        'signed-tunnel',
        'review',
        'image-digest',
      ),
      executionCacheKey(
        1,
        { ...request, commit: 'f'.repeat(40) },
        'signed-tunnel',
        'review',
        'image-digest',
      ),
      executionCacheKey(
        1,
        { ...request, contractHash: '9'.repeat(64) },
        'signed-tunnel',
        'review',
        'image-digest',
      ),
      executionCacheKey(
        1,
        { ...request, policy: { ...request.policy, entrypoint: 'index.mjs' } },
        'signed-tunnel',
        'review',
        'image-digest',
      ),
      executionCacheKey(1, request, 'durable-object', 'review', 'image-digest'),
      executionCacheKey(
        1,
        request,
        'signed-tunnel',
        'production',
        'image-digest',
      ),
      executionCacheKey(
        1,
        request,
        'signed-tunnel',
        'review',
        'new-image-digest',
      ),
      executionCacheKey(
        1,
        { ...request, timeoutSeconds: 61 },
        'signed-tunnel',
        'review',
        'image-digest',
      ),
    ];
    for (const changedKey of await Promise.all(changed))
      expect(changedKey).not.toBe(key);
  });

  it('stores only a safe request summary and validates original identity on a hit', async () => {
    const f = fixture();
    const stored = await originRecord(f);
    const key = await executionCacheKey(
      1,
      request,
      'signed-tunnel',
      'review',
      'image-digest',
    );
    const currentRequest = { ...request, runId: '2'.repeat(64) };
    const entry = {
      cache_key: key,
      request_hash: stored.requestHash,
      result_hash: stored.resultHash,
      request: stored.requestText,
      result: stored.resultText,
    };
    const hit = await verifiedCacheEntry(
      entry,
      key,
      currentRequest,
      validateRunnerResult,
    );
    expect(hit?.requestHash).toBe(stored.requestHash);
    expect(hit?.startedAt).toBe(stored.result.startedAt);
    expect(stored.requestText).not.toContain('export default');
    expect(JSON.parse(stored.requestText).files[0]).toMatchObject({
      path: 'server.mjs',
      sha256: expect.any(String),
      bytes: 17,
    });
  });

  it('rejects corrupted hashes, request summaries, malformed output and origin mismatches', async () => {
    const f = fixture();
    const stored = await originRecord(f);
    const key = await executionCacheKey(
      1,
      request,
      'signed-tunnel',
      'review',
      'image-digest',
    );
    const entry = {
      cache_key: key,
      request_hash: stored.requestHash,
      result_hash: stored.resultHash,
      request: stored.requestText,
      result: stored.resultText,
    };
    expect(
      await verifiedCacheEntry(
        { ...entry, result_hash: '0'.repeat(64) },
        key,
        request,
        validateRunnerResult,
      ),
    ).toBeNull();
    expect(
      await verifiedCacheEntry(
        { ...entry, request: '{}' },
        key,
        request,
        validateRunnerResult,
      ),
    ).toBeNull();
    expect(
      await verifiedCacheEntry(
        { ...entry, result: '{}' },
        key,
        request,
        validateRunnerResult,
      ),
    ).toBeNull();
    expect(
      await verifiedCacheEntry(
        { ...entry, request_hash: '0'.repeat(64) },
        key,
        request,
        validateRunnerResult,
      ),
    ).toBeNull();
    expect(
      await verifiedCacheEntry(
        { ...entry, cache_key: '0'.repeat(64) },
        key,
        request,
        validateRunnerResult,
      ),
    ).toBeNull();
  });

  it('enforces immutable entries and keeps cross-repository keys independent', async () => {
    const f = fixture();
    const origin = await originRecord(f);
    const key = '8'.repeat(64);
    const originalCreatedAt = '2026-10-02 00:00:01';
    f.sql
      .prepare('UPDATE execution_results SET created_at=? WHERE id=?')
      .run(originalCreatedAt, origin.executionId);
    const insert =
      'INSERT INTO execution_cache(repository_id,cache_key,origin_run_id,origin_execution_id,request_hash,result_hash,request,result,created_at) VALUES(?,?,?,?,?,?,?,?,?)';
    f.sql
      .prepare(insert)
      .run(
        1,
        key,
        originRunId,
        origin.executionId,
        origin.requestHash,
        origin.resultHash,
        origin.requestText,
        origin.resultText,
        '2026-10-02 00:00:02',
      );
    const otherRunId = 'e'.repeat(64);
    const otherExecutionId = '22222222-2222-4222-8222-222222222222';
    f.sql
      .prepare(
        'INSERT INTO execution_results(id,run_id,commit_sha,request_hash,result_hash,result,request) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        otherExecutionId,
        otherRunId,
        head,
        origin.requestHash,
        origin.resultHash,
        origin.resultText,
        origin.requestText,
      );
    f.sql
      .prepare(insert)
      .run(
        2,
        key,
        otherRunId,
        otherExecutionId,
        origin.requestHash,
        origin.resultHash,
        origin.requestText,
        origin.resultText,
        '2026-10-02 00:00:02',
      );
    expect(
      f.sql
        .prepare('SELECT count(*) AS n FROM execution_cache WHERE cache_key=?')
        .get(key),
    ).toMatchObject({ n: 2 });
    const provenance = f.sql
      .prepare(
        'SELECT ec.created_at AS cache_created_at,er.created_at AS origin_created_at FROM execution_cache ec JOIN evaluations o ON o.id=ec.origin_run_id AND o.repository_id=ec.repository_id JOIN execution_results er ON er.id=ec.origin_execution_id AND er.run_id=ec.origin_run_id WHERE ec.repository_id=1 AND ec.cache_key=?',
      )
      .get(key) as { cache_created_at: string; origin_created_at: string };
    expect(provenance).toEqual({
      cache_created_at: '2026-10-02 00:00:02',
      origin_created_at: originalCreatedAt,
    });
    const currentRunId = '2'.repeat(64);
    f.sql
      .prepare('INSERT INTO evaluations(id,repository_id) VALUES(?,1)')
      .run(currentRunId);
    f.sql
      .prepare(
        'INSERT INTO execution_results(id,run_id,commit_sha,request_hash,result_hash,result,request,origin_run_id,origin_execution_id,cache_key,cache_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        '33333333-3333-4333-8333-333333333333',
        currentRunId,
        head,
        origin.requestHash,
        origin.resultHash,
        origin.resultText,
        origin.requestText,
        originRunId,
        origin.executionId,
        key,
        'HIT',
        provenance.origin_created_at,
      );
    expect(
      f.sql
        .prepare(
          'SELECT created_at,origin_run_id,origin_execution_id FROM execution_results WHERE run_id=?',
        )
        .get(currentRunId),
    ).toMatchObject({
      created_at: originalCreatedAt,
      origin_run_id: originRunId,
      origin_execution_id: origin.executionId,
    });
    expect(() =>
      f.sql
        .prepare(
          'UPDATE execution_cache SET result=? WHERE repository_id=1 AND cache_key=?',
        )
        .run('{}', key),
    ).toThrow(/immutable/);
    expect(() =>
      f.sql
        .prepare(
          'DELETE FROM execution_cache WHERE repository_id=1 AND cache_key=?',
        )
        .run(key),
    ).toThrow(/immutable/);
  });

  it('keeps the current cache key empty for UNVERIFIED output', async () => {
    const f = fixture();
    const key = await executionCacheKey(
      1,
      request,
      'signed-tunnel',
      'review',
      'image-digest',
    );
    const before = await f.DB.prepare(
      'SELECT count(*) AS n FROM execution_cache WHERE repository_id=? AND cache_key=?',
    )
      .bind(1, key)
      .first<{ n: number }>();
    const incomplete = resultFor(request);
    incomplete.checks[0]!.status = 'UNVERIFIED';
    if (
      cacheableResult(incomplete, canonical(incomplete), request.timeoutSeconds)
    ) {
      throw new Error('UNVERIFIED results must not reach cache insertion');
    }
    const after = await f.DB.prepare(
      'SELECT count(*) AS n FROM execution_cache WHERE repository_id=? AND cache_key=?',
    )
      .bind(1, key)
      .first<{ n: number }>();
    expect(before?.n).toBe(0);
    expect(after?.n).toBe(0);
  });

  it('requires complete, redacted outputs before an execution can be cached', () => {
    const valid = resultFor(request);
    expect(
      cacheableResult(valid, canonical(valid), request.timeoutSeconds),
    ).toBe(true);
    const incomplete = structuredClone(valid);
    incomplete.checks[0]!.status = 'UNVERIFIED';
    expect(
      cacheableResult(
        incomplete,
        canonical(incomplete),
        request.timeoutSeconds,
      ),
    ).toBe(false);
    const tooLong = structuredClone(valid);
    tooLong.checks[0]!.durationMs = request.timeoutSeconds * 1000 + 1;
    expect(
      cacheableResult(tooLong, canonical(tooLong), request.timeoutSeconds),
    ).toBe(false);
    const secret = structuredClone(valid);
    secret.checks[0]!.stdout = 'ghp_123456789012345678901234567890';
    expect(
      cacheableResult(secret, canonical(secret), request.timeoutSeconds),
    ).toBe(false);
  });
});
