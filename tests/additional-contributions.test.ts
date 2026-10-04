import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  createCandidate,
  listCandidates,
  reviewCandidate,
} from '../src/additional-contributions';
import type { Env } from '../src/env';

const runId = 'run-additional';
const evidence = [
  {
    id: 'criterion-doc',
    kind: 'source',
    criterionId: 'doc-opt',
    path: 'README.md',
    status: 'PASS',
    baselineStatus: 'FAIL',
    claim: 'Objective source assertion.',
  },
];
const contract = {
  schemaVersion: 1,
  evaluationVersion: 'eval-v1',
  challengeVersion: 'challenge-v1',
  repository: { id: 1, fullName: 'example/repo', installationId: 2 },
  department: 'engineering',
  category: 'web',
  baseline: 'a'.repeat(40),
  issueNumbers: [2],
  constraints: [],
  forbiddenPaths: [],
  additionalCategories: ['testing', 'documentation'],
  requirements: [
    {
      id: 'optional-docs',
      title: 'Optional documentation improvement',
      mandatory: false,
      criteria: [
        {
          id: 'doc-opt',
          description: 'README includes usage instructions.',
          kind: 'source',
          verification: {
            type: 'file_contains',
            path: 'README.md',
            text: 'Usage',
          },
        },
      ],
    },
    {
      id: 'required',
      title: 'Required documentation',
      mandatory: true,
      criteria: [
        {
          id: 'required-criterion',
          description: 'README includes required documentation.',
          kind: 'source',
          verification: {
            type: 'file_contains',
            path: 'README.md',
            text: 'Required',
          },
        },
      ],
    },
  ],
  execution: {
    environment: 'node-v1',
    network: 'deny',
    timeoutSeconds: 60,
    memoryMiB: 256,
    maxFiles: 10,
    maxFileBytes: 100000,
  },
};

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE repositories(id INTEGER PRIMARY KEY);
    CREATE TABLE evaluations(
      id TEXT PRIMARY KEY,repository_id INTEGER,pr_number INTEGER,head_sha TEXT,state TEXT,
      contract_snapshot TEXT,assignment_snapshot TEXT,context TEXT,evidence TEXT
    );
    CREATE TABLE submissions(
      repository_id INTEGER,pr_number INTEGER,head_sha TEXT,latest_run_id TEXT,closed INTEGER,status TEXT,team_id TEXT,
      PRIMARY KEY(repository_id,pr_number)
    );
    CREATE TABLE hackathons(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE teams(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE team_repositories(team_id TEXT,repository_id INTEGER,active INTEGER);
    CREATE TABLE github_repositories(id INTEGER PRIMARY KEY,accessible INTEGER);
    CREATE TABLE issue_assignments(id TEXT PRIMARY KEY,repository_id INTEGER,issue_number INTEGER,status TEXT,expires_at TEXT);
    CREATE TABLE github_issues(repository_id INTEGER,number INTEGER,review_status TEXT,github_state TEXT,official INTEGER);
    CREATE TABLE team_members(team_id TEXT,github_id INTEGER,active INTEGER);
    CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT,entity TEXT,actor TEXT,changes TEXT);
  `);
  sql.exec(
    readFileSync('migrations/0013_additional_contributions.sql', 'utf8'),
  );
  sql.prepare('INSERT INTO repositories(id) VALUES(1)').run();
  sql
    .prepare('INSERT INTO github_repositories(id,accessible) VALUES(1,1)')
    .run();
  sql
    .prepare('INSERT INTO teams(id,status) VALUES(?,?)')
    .run('team-1', 'ACTIVE');
  sql
    .prepare(
      'INSERT INTO team_repositories(team_id,repository_id,active) VALUES(?,?,1)',
    )
    .run('team-1', 1);
  sql
    .prepare(
      'INSERT INTO evaluations(id,repository_id,pr_number,head_sha,state,contract_snapshot,assignment_snapshot,context,evidence) VALUES(?,1,2,?,?,?, ?,?,?)',
    )
    .run(
      runId,
      'a'.repeat(40),
      'COMPLETED',
      JSON.stringify(contract),
      JSON.stringify({ team_id: 'team-1', resolution_snapshot: null }),
      JSON.stringify({ files: [{ filename: 'README.md' }] }),
      JSON.stringify(evidence),
    );
  sql
    .prepare(
      'INSERT INTO submissions(repository_id,pr_number,head_sha,latest_run_id,closed,status,team_id) VALUES(1,2,?,?,0,?,?)',
    )
    .run('a'.repeat(40), runId, 'VALID', 'team-1');
  sql
    .prepare('INSERT INTO hackathons(id,status) VALUES(?,?)')
    .run('initial', 'ACTIVE');

  const DB = {
    prepare(query: string) {
      let values: unknown[] = [];
      const prepared = {
        bind(...args: unknown[]) {
          values = args;
          return prepared;
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
            results: sql
              .prepare(query)
              .all(...(values as never[] as never[])) as T[],
          };
        },
      };
      return prepared;
    },
    async batch(statements: ReturnType<typeof DBPrepare>[]) {
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
  function DBPrepare() {
    return DB.prepare('SELECT 1');
  }
  return { sql, env: { DB } as unknown as Env };
}

const candidateInput = {
  category: 'documentation',
  title: 'Add clear setup instructions',
  description: 'Adds a concise setup guide for the repository contributors.',
  paths: ['README.md'],
  evidenceIds: ['criterion-doc'],
  criterionIds: ['doc-opt'],
};

it('creates immutable candidates from exact frozen paths and optional evidence', async () => {
  const f = fixture();
  const result = await createCandidate(
    f.env,
    runId,
    'organizer:session',
    candidateInput,
  );
  expect(result.status).toBe(201);
  expect(result.body).toMatchObject({
    runId,
    category: 'documentation',
    paths: ['README.md'],
    verificationStatus: 'VERIFIED',
    latestDecision: null,
  });
  const [candidate] = await listCandidates(f.env, runId);
  expect(candidate?.id).toBe((result.body as { id: string }).id);
  expect(() =>
    f.sql
      .prepare('UPDATE additional_contributions SET title=? WHERE id=?')
      .run(...(['Changed title', candidate?.id] as never[])),
  ).toThrow();
  f.sql.close();
});

it('leaves unbound or mandatory-only work unverified and rejects unknown paths', async () => {
  const f = fixture();
  const unbound = await createCandidate(f.env, runId, 'organizer:session', {
    ...candidateInput,
    criterionIds: [],
  });
  expect(unbound.body).toMatchObject({ verificationStatus: 'UNVERIFIED' });
  const mandatory = await createCandidate(f.env, runId, 'organizer:session', {
    ...candidateInput,
    criterionIds: ['required-criterion'],
  });
  expect(mandatory.status).toBe(400);
  const badPath = await createCandidate(f.env, runId, 'organizer:session', {
    ...candidateInput,
    paths: ['unmodified.ts'],
  });
  expect(badPath.status).toBe(400);
  f.sql.close();
});

it('recognizes only the current verified run and makes review replay idempotent', async () => {
  const f = fixture();
  const created = await createCandidate(
    f.env,
    runId,
    'organizer:session',
    candidateInput,
  );
  const id = (created.body as { id: string }).id;
  const request = {
    decision: 'RECOGNIZED' as const,
    reason: 'Verified optional objective evidence on the current submission.',
    requestId: '12345678-1234-4234-8234-123456789abc',
    expectedPreviousSequence: null,
  };
  const first = await reviewCandidate(f.env, id, 'organizer:session', request);
  const replay = await reviewCandidate(f.env, id, 'organizer:session', request);
  expect(first.status).toBe(200);
  expect(replay).toEqual(first);
  expect((await listCandidates(f.env, runId))[0]?.latestDecision).toMatchObject(
    {
      decision: 'RECOGNIZED',
      candidateId: id,
    },
  );
  const conflict = await reviewCandidate(f.env, id, 'organizer:session', {
    ...request,
    requestId: '22345678-1234-4234-8234-123456789abc',
    expectedPreviousSequence: null,
    decision: 'REJECTED',
  });
  expect(conflict.status).toBe(409);
  f.sql.close();
});

it('caps candidates at twenty per run', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++)
    expect(
      (
        await createCandidate(f.env, runId, 'organizer:session', {
          ...candidateInput,
          title: `Contribution ${i}`,
        })
      ).status,
    ).toBe(201);
  expect(
    (await createCandidate(f.env, runId, 'organizer:session', candidateInput))
      .status,
  ).toBe(409);
  f.sql.close();
});
