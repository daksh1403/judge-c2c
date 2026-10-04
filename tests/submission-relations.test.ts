import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  createSubmissionRelation,
  listSubmissionRelations,
} from '../src/submission-relations';
import type { Env } from '../src/env';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(
    'CREATE TABLE submissions(repository_id INTEGER,pr_number INTEGER,status TEXT,team_id TEXT,issue_numbers TEXT,author_id INTEGER,head_sha TEXT,PRIMARY KEY(repository_id,pr_number))',
  );
  sql.exec(
    'CREATE TABLE audit(id INTEGER PRIMARY KEY,action TEXT,entity TEXT,actor TEXT,changes TEXT)',
  );
  sql.exec('CREATE TABLE evaluations(id TEXT PRIMARY KEY,state TEXT)');
  sql.exec("INSERT INTO evaluations VALUES('existing-run','COMPLETED')");
  sql.exec(readFileSync('migrations/0015_submission_relations.sql', 'utf8'));
  sql.exec(
    readFileSync('migrations/0019_stacked_submission_relations.sql', 'utf8'),
  );
  for (const pr of [1, 2, 3])
    sql
      .prepare('INSERT INTO submissions VALUES(1,?,?,?,?,?,?)')
      .run(
        pr,
        pr === 2 ? 'CLOSED' : 'VALID',
        'team-1',
        '[10,20]',
        pr,
        String(pr).repeat(40),
      );
  let beforeBatch: (() => void) | undefined;
  const DB = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) {
          values = args;
          return statement;
        },
        async run() {
          const result = sql.prepare(query).run(...(values as never[]));
          return { meta: { changes: Number(result.changes) } };
        },
        async first<T>() {
          return (
            (sql.prepare(query).get(...(values as never[])) as T | undefined) ??
            null
          );
        },
        async all<T>() {
          return {
            results: sql.prepare(query).all(...(values as never[])) as T[],
          };
        },
      };
      return statement;
    },
    async batch(
      statements: { run(): Promise<{ meta: { changes: number } }> }[],
    ) {
      beforeBatch?.();
      beforeBatch = undefined;
      sql.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return {
    sql,
    db: DB as unknown as D1Database,
    env: { ORG_DB: DB } as unknown as Env,
    race(callback: () => void) {
      beforeBatch = callback;
    },
  };
}
function input(
  sourcePr = 1,
  targetPr = 2,
  kind: 'ALTERNATE' | 'DUPLICATE' | 'SUPERSEDES' | 'DEPENDS_ON' = 'ALTERNATE',
) {
  return {
    repositoryId: 1,
    sourcePr,
    targetPr,
    kind,
    reason: 'Organizer reviewed structured team and assignment mapping.',
    requestId: crypto.randomUUID(),
  };
}

it('records immutable audited relations for mapped same-team attempts without changing evaluation history', async () => {
  const f = fixture(),
    request = input();
  const result = await createSubmissionRelation(
    f.env,
    'organizer:session',
    request,
  );
  expect(result.status).toBe(201);
  expect(result.body).toMatchObject({
    ...request,
    teamId: 'team-1',
    issueNumbers: [10, 20],
    actor: 'organizer:session',
  });
  expect(await listSubmissionRelations(f.db, 1, 1)).toHaveLength(1);
  expect(await listSubmissionRelations(f.db, 1, 2)).toHaveLength(1);
  expect(await listSubmissionRelations(f.db, 2, 1)).toHaveLength(0);
  expect(f.sql.prepare('SELECT count(*) n FROM audit').get()?.n).toBe(1);
  expect(f.sql.prepare('SELECT state FROM evaluations').get()?.state).toBe(
    'COMPLETED',
  );
  expect(
    f.sql.prepare('SELECT status FROM submissions WHERE pr_number=2').get()
      ?.status,
  ).toBe('CLOSED');
  expect(() =>
    f.sql.prepare("UPDATE submission_relations SET kind='DUPLICATE'").run(),
  ).toThrow(/immutable/);
  expect(() => f.sql.prepare('DELETE FROM submission_relations').run()).toThrow(
    /immutable/,
  );
  f.sql.close();
});

it('replays the same request without another audit and rejects changed payload or actor', async () => {
  const f = fixture(),
    request = input();
  const first = await createSubmissionRelation(f.env, 'organizer', request);
  f.sql.prepare("UPDATE submissions SET status='NEEDS_TEAM_MAPPING'").run();
  const replay = await createSubmissionRelation(f.env, 'organizer', request);
  expect(replay).toEqual({ status: 200, body: first.body });
  expect(
    (
      await createSubmissionRelation(f.env, 'organizer', {
        ...request,
        kind: 'DUPLICATE',
      })
    ).status,
  ).toBe(409);
  expect(
    (await createSubmissionRelation(f.env, 'other-organizer', request)).status,
  ).toBe(409);
  expect(f.sql.prepare('SELECT count(*) n FROM audit').get()?.n).toBe(1);
  f.sql.close();
});

it('requires known structured mappings, same team and an actual shared positive integer issue', async () => {
  for (const update of [
    "UPDATE submissions SET team_id='other' WHERE pr_number=2",
    'UPDATE submissions SET team_id=NULL WHERE pr_number=2',
    "UPDATE submissions SET issue_numbers='[30]' WHERE pr_number=2",
    'UPDATE submissions SET issue_numbers=\'["10","20"]\' WHERE pr_number=2',
    "UPDATE submissions SET status='NEEDS_ISSUE_MAPPING' WHERE pr_number=2",
    'DELETE FROM submissions WHERE pr_number=2',
  ]) {
    const f = fixture();
    f.sql.exec(update);
    expect(
      (await createSubmissionRelation(f.env, 'organizer', input())).status,
    ).toBe(409);
    expect(f.sql.prepare('SELECT count(*) n FROM audit').get()?.n).toBe(0);
    f.sql.close();
  }
  const f = fixture();
  f.sql
    .prepare('UPDATE submissions SET repository_id=2 WHERE pr_number=2')
    .run();
  expect(
    (await createSubmissionRelation(f.env, 'organizer', input())).status,
  ).toBe(409);
  f.sql.close();
});

it('rejects self relations, malformed requests, short reasons and unsupported STACKED policy', async () => {
  const f = fixture();
  for (const request of [
    input(1, 1),
    { ...input(), kind: 'STACKED' },
    { ...input(), requestId: 'not-uuid' },
    { ...input(), reason: 'too short' },
    { ...input(), repositoryId: -1 },
    { ...input(), targetRepositoryId: 2 },
  ]) {
    expect(
      (await createSubmissionRelation(f.env, 'organizer', request)).status,
    ).toBe(400);
  }
  expect((await createSubmissionRelation(f.env, '', input())).status).toBe(400);
  expect(await listSubmissionRelations(f.db, 1, 1)).toHaveLength(0);
  f.sql.close();
});

it('prevents reverse and transitive supersession cycles without restricting alternate labels', async () => {
  const f = fixture();
  expect(
    (
      await createSubmissionRelation(
        f.env,
        'organizer',
        input(1, 2, 'SUPERSEDES'),
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await createSubmissionRelation(
        f.env,
        'organizer',
        input(2, 3, 'SUPERSEDES'),
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await createSubmissionRelation(
        f.env,
        'organizer',
        input(2, 1, 'SUPERSEDES'),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await createSubmissionRelation(
        f.env,
        'organizer',
        input(3, 1, 'SUPERSEDES'),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await createSubmissionRelation(
        f.env,
        'organizer',
        input(3, 1, 'ALTERNATE'),
      )
    ).status,
  ).toBe(201);
  expect(f.sql.prepare('SELECT count(*) n FROM audit').get()?.n).toBe(3);
  f.sql.close();
});

it('caps relations at twenty for either endpoint while still allowing idempotent replay', async () => {
  const f = fixture(),
    first = input();
  expect(
    (await createSubmissionRelation(f.env, 'organizer', first)).status,
  ).toBe(201);
  for (let n = 1; n < 20; n++)
    expect(
      (await createSubmissionRelation(f.env, 'organizer', input())).status,
    ).toBe(201);
  expect(
    (await createSubmissionRelation(f.env, 'organizer', input(1, 3))).status,
  ).toBe(409);
  expect(
    (await createSubmissionRelation(f.env, 'organizer', input(3, 2))).status,
  ).toBe(409);
  expect(
    (await createSubmissionRelation(f.env, 'organizer', first)).status,
  ).toBe(200);
  expect(f.sql.prepare('SELECT count(*) n FROM audit').get()?.n).toBe(20);
  f.sql.close();
});

it('checks eligibility inside the insert transaction rather than trusting a prior read', async () => {
  const f = fixture();
  f.race(() =>
    f.sql
      .prepare(
        "UPDATE submissions SET team_id='changed-team' WHERE pr_number=2",
      )
      .run(),
  );
  expect(
    (await createSubmissionRelation(f.env, 'organizer', input())).status,
  ).toBe(409);
  expect(await listSubmissionRelations(f.db, 1, 1)).toHaveLength(0);
  f.sql.close();
});

it('rolls the relation back if its audit cannot be recorded', async () => {
  const f = fixture();
  f.sql.exec(
    "CREATE TRIGGER fail_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;",
  );
  await expect(
    createSubmissionRelation(f.env, 'organizer', input()),
  ).rejects.toThrow(/audit unavailable/);
  expect(await listSubmissionRelations(f.db, 1, 1)).toHaveLength(0);
  f.sql.close();
});

it('pins stacked dependencies without inherited credit and rejects transitive dependency cycles', async () => {
  const f = fixture();
  const first = await createSubmissionRelation(
    f.env,
    'organizer',
    input(1, 2, 'DEPENDS_ON'),
  );
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({
    sourceHead: '1'.repeat(40),
    targetHead: '2'.repeat(40),
    evaluationPolicy: 'INDEPENDENT_FROZEN_BASELINE_NO_DEPENDENCY_CREDIT',
  });
  f.sql
    .prepare('UPDATE submissions SET head_sha=? WHERE pr_number=2')
    .run('a'.repeat(40));
  expect((await listSubmissionRelations(f.db, 1, 1))[0]!.targetHead).toBe(
    '2'.repeat(40),
  );
  expect(
    (
      await createSubmissionRelation(
        f.env,
        'organizer',
        input(2, 3, 'DEPENDS_ON'),
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await createSubmissionRelation(
        f.env,
        'organizer',
        input(3, 1, 'DEPENDS_ON'),
      )
    ).status,
  ).toBe(409);
  expect(f.sql.prepare('SELECT state FROM evaluations').get()?.state).toBe(
    'COMPLETED',
  );
  f.sql.close();
});
