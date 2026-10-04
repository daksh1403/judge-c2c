import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  captureRunMeasurements,
  readRunMeasurements,
} from '../src/run-measurements';
import { RUNNER_VERSION } from '../src/runner-policy';

it('captures once, excludes reused execution timings and retains missing measurements as absent', async () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec(
      'CREATE TABLE evaluations(id TEXT PRIMARY KEY,state TEXT,created_at TEXT,updated_at TEXT,report TEXT,context TEXT); CREATE TABLE execution_results(run_id TEXT,result TEXT,cache_status TEXT); CREATE TABLE timeline(id INTEGER PRIMARY KEY,run_id TEXT,state TEXT,created_at TEXT);',
    );
    sql.exec(readFileSync('migrations/0017_run_measurements.sql', 'utf8'));
    sql.exec(readFileSync('migrations/0020_runner_measurements.sql', 'utf8'));
    sql.exec(readFileSync('migrations/0022_stage_measurements.sql', 'utf8'));
    const id = 'a'.repeat(64);
    sql
      .prepare(
        'INSERT INTO evaluations(id,state,created_at,updated_at,report) VALUES(?,?,?,?,?)',
      )
      .run(
        id,
        'COMPLETED',
        '2026-10-04 00:00:00',
        '2026-10-04 00:00:05',
        JSON.stringify({
          aiTrace: {
            durationMs: 20,
            attempts: 2,
            usage: { input_tokens: 40, output_tokens: 10 },
            toolCalls: [{ tool: 'read' }],
          },
        }),
      );
    sql
      .prepare('INSERT INTO timeline(run_id,state,created_at) VALUES(?,?,?)')
      .run(id, 'QUEUED', '2026-10-04 00:00:00');
    sql
      .prepare('INSERT INTO timeline(run_id,state,created_at) VALUES(?,?,?)')
      .run(id, 'FETCHING', '2026-10-04 00:00:01');
    sql
      .prepare('INSERT INTO timeline(run_id,state,created_at) VALUES(?,?,?)')
      .run(id, 'CHECKING', '2026-10-04 00:00:02');
    const result = {
      requestHash: 'b'.repeat(64),
      commit: 'c'.repeat(40),
      contractHash: 'd'.repeat(64),
      version: RUNNER_VERSION,
      image: 'image',
      runtime: 'node',
      metrics: {
        startupMs: 123,
        resources: [
          {
            scope: 'service',
            sampledAt: '2026-10-04T00:00:02.000Z',
            cpuUsageUsec: 5000000,
            memoryBytes: 32000000,
            pids: 3,
          },
          {
            scope: 'service',
            sampledAt: '2026-10-04T00:00:03.000Z',
            cpuUsageUsec: 6000000,
            memoryBytes: 31000000,
            pids: 2,
          },
        ],
      },
      startedAt: '2026-10-04T00:00:01.000Z',
      finishedAt: '2026-10-04T00:00:03.000Z',
      checks: [
        {
          id: 'test',
          kind: 'test',
          status: 'PASS',
          exitCode: 0,
          durationMs: 120,
          stdout: '',
          stderr: '',
          detail: 'Done',
        },
      ],
    };
    sql
      .prepare('INSERT INTO execution_results VALUES(?,?,?)')
      .run(id, JSON.stringify(result), 'HIT');
    sql
      .prepare('INSERT INTO execution_results VALUES(?,?,?)')
      .run(id, JSON.stringify(result), 'MISS');
    const db = {
      prepare(query: string) {
        let args: any[] = [];
        const stmt = {
          bind(...v: any[]) {
            args = v;
            return stmt;
          },
          async first() {
            return sql.prepare(query).get(...args) ?? null;
          },
          async all() {
            return { results: sql.prepare(query).all(...args) };
          },
          async run() {
            return sql.prepare(query).run(...args);
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
    await captureRunMeasurements(db, id);
    await captureRunMeasurements(db, id);
    const rows = await readRunMeasurements(db, 60);
    const find = (metric: string) =>
      rows.find((r: any) => r.metric === metric) as any;
    expect(find('queue.waitMs')).toMatchObject({ sum: 1000 });
    expect(find('stage.fetching.durationMs')).toMatchObject({ sum: 1000 });
    expect(find('evaluation.durationMs')).toMatchObject({
      count: 1,
      sum: 5000,
    });
    expect(find('check.test.durationMs')).toMatchObject({ count: 1, sum: 120 });
    expect(find('runner.durationMs')).toMatchObject({ sum: 2000 });
    expect(find('runner.startupMs')).toMatchObject({ sum: 123 });
    expect(find('runner.cpuUsageUsec')).toMatchObject({ sum: 6000000 });
    expect(find('runner.sampledMemoryBytes')).toMatchObject({ sum: 32000000 });
    expect(find('cache.hit')).toMatchObject({ sum: 1 });
    expect(find('ai.inputTokens')).toMatchObject({ sum: 40 });
    expect(find('ai.toolCalls')).toMatchObject({ sum: 1 });
    expect(find('ai.cost')).toBeUndefined();
    await expect(readRunMeasurements(db, 0)).rejects.toThrow(
      'INVALID_METRICS_WINDOW',
    );
  } finally {
    sql.close();
  }
});
