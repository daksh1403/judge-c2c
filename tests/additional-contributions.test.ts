import { paymentRetryPolicy } from '../src/runner-policy';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  createCandidate,
  discoverAdditionalContributions,
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

it('discovers bounded diff suggestions with server provenance and idempotent replay but no automatic recognition', async () => {
  const f = fixture();
  f.sql
    .prepare(
      'UPDATE evaluations SET head_sha=?,context=?,evidence=? WHERE id=?',
    )
    .run(
      'b'.repeat(40),
      JSON.stringify({
        files: [
          { filename: 'README.md', status: 'added', additions: 10 },
          { filename: 'tests/new.test.ts', status: 'added', additions: 10 },
          { filename: 'docs/extra.md', status: 'added', additions: 10 },
        ],
      }),
      JSON.stringify([
        ...evidence,
        {
          id: 'diff',
          kind: 'diff',
          status: 'PASS',
          claim: 'Frozen baseline/head comparison.',
        },
      ]),
      runId,
    );
  const first = await discoverAdditionalContributions(f.env, runId);
  expect(first.status).toBe('SUGGESTED');
  expect(first.candidateIds).toHaveLength(2);
  const replay = await discoverAdditionalContributions(f.env, runId);
  expect(replay).toEqual(first);
  const candidates = await listCandidates(f.env, runId);
  expect(candidates).toHaveLength(2);
  for (const candidate of candidates) {
    expect(candidate.actor).toBe('system:additional-discovery-v1');
    expect(candidate.verificationStatus).toBe('UNVERIFIED');
    expect(candidate.latestDecision).toBeNull();
    expect(candidate.paths).not.toContain('README.md');
  }
  expect(
    f.sql
      .prepare(
        "SELECT count(*) n FROM audit WHERE action='additional_contribution.created'",
      )
      .get()?.n,
  ).toBe(2);
  expect(
    f.sql
      .prepare('SELECT count(*) n FROM additional_contribution_decisions')
      .get()?.n,
  ).toBe(0);
  f.sql.close();
});
it('suggests optional trusted functional improvements separately from required work and leaves attribution to organizers', async () => {
  const f = fixture();
  const frozen = structuredClone(contract);
  frozen.execution = {
    ...frozen.execution,
    memoryMiB: 256,
    runner: paymentRetryPolicy,
  } as typeof frozen.execution;
  frozen.requirements.push({
    id: 'extra-function',
    title: 'Optional functional improvement',
    mandatory: false,
    criteria: [
      {
        id: 'extra-opt',
        description: 'Extra bounded retry',
        kind: 'functional',
        verification: { type: 'runner', checkId: 'retry-bounded' },
      },
    ],
  } as never);
  f.sql
    .prepare(
      'UPDATE evaluations SET head_sha=?,contract_snapshot=?,context=?,evidence=? WHERE id=?',
    )
    .run(
      'b'.repeat(40),
      JSON.stringify(frozen),
      JSON.stringify({
        files: [{ filename: 'server.mjs', status: 'modified', additions: 5 }],
      }),
      JSON.stringify([
        {
          id: 'diff',
          kind: 'diff',
          status: 'PASS',
          claim: 'Frozen comparison.',
        },
        {
          id: 'functional-extra',
          kind: 'execution',
          criterionId: 'extra-opt',
          status: 'PASS',
          baselineStatus: 'FAIL',
          claim: 'Trusted optional check passed.',
        },
      ]),
      runId,
    );
  const found = await discoverAdditionalContributions(f.env, runId);
  expect(found.candidateIds).toHaveLength(1);
  const [candidate] = await listCandidates(f.env, runId);
  expect(candidate).toMatchObject({
    category: 'testing',
    criterionIds: ['extra-opt'],
    verificationStatus: 'VERIFIED',
    latestDecision: null,
    paths: ['server.mjs'],
  });
  expect(candidate!.description).toContain('not proof of authorship');
  f.sql.close();
});
it.each([
  {
    id: 'policy',
    kind: 'policy',
    status: 'FAIL',
    claim: 'Protected path changed.',
  },
  {
    id: 'regression',
    kind: 'execution',
    status: 'FAIL',
    baselineStatus: 'PASS',
    claim: 'Regression.',
  },
])(
  'blocks discovery on policy violation or observed regression',
  async (blocker) => {
    const f = fixture();
    f.sql
      .prepare(
        'UPDATE evaluations SET head_sha=?,context=?,evidence=? WHERE id=?',
      )
      .run(
        'b'.repeat(40),
        JSON.stringify({
          files: [
            { filename: 'tests/extra.test.ts', status: 'added', additions: 5 },
          ],
        }),
        JSON.stringify([
          {
            id: 'diff',
            kind: 'diff',
            status: 'PASS',
            claim: 'Frozen comparison.',
          },
          blocker,
        ]),
        runId,
      );
    expect(await discoverAdditionalContributions(f.env, runId)).toEqual({
      status: 'BLOCKED_POLICY_OR_REGRESSION',
      candidateIds: [],
    });
    expect(await listCandidates(f.env, runId)).toEqual([]);
    f.sql.close();
  },
);
it('does not discover changed existing docs as novel, unknown categories or required-path additions', async () => {
  const f = fixture();
  f.sql
    .prepare(
      'UPDATE evaluations SET head_sha=?,context=?,evidence=? WHERE id=?',
    )
    .run(
      'b'.repeat(40),
      JSON.stringify({
        files: [
          { filename: 'docs/old.md', status: 'modified', additions: 5 },
          { filename: 'README.md', status: 'added', additions: 5 },
          { filename: 'new-component.ts', status: 'added', additions: 5 },
        ],
      }),
      JSON.stringify([
        {
          id: 'diff',
          kind: 'diff',
          status: 'PASS',
          claim: 'Frozen comparison.',
        },
      ]),
      runId,
    );
  expect(
    (await discoverAdditionalContributions(f.env, runId)).candidateIds,
  ).toEqual([]);
  f.sql.close();
});

it('caps automatic discovery at five suggestions and preserves the existing twenty-candidate run limit', async () => {
  const f = fixture();
  f.sql
    .prepare(
      'UPDATE evaluations SET head_sha=?,context=?,evidence=? WHERE id=?',
    )
    .run(
      'b'.repeat(40),
      JSON.stringify({
        files: Array.from({ length: 30 }, (_, index) => ({
          filename: `docs/extra-${index}.md`,
          status: 'added',
          additions: 2,
        })),
      }),
      JSON.stringify([
        {
          id: 'diff',
          kind: 'diff',
          status: 'PASS',
          claim: 'Frozen comparison.',
        },
      ]),
      runId,
    );
  expect(
    (await discoverAdditionalContributions(f.env, runId)).candidateIds,
  ).toHaveLength(5);
  expect(await listCandidates(f.env, runId)).toHaveLength(5);
  expect(
    (await discoverAdditionalContributions(f.env, runId)).candidateIds,
  ).toHaveLength(5);
  expect(await listCandidates(f.env, runId)).toHaveLength(5);
  f.sql.close();
});
it('does not discover suggestions before completion or when baseline and head are identical', async () => {
  const f = fixture();
  expect(
    (await discoverAdditionalContributions(f.env, runId)).candidateIds,
  ).toEqual([]);
  f.sql
    .prepare("UPDATE evaluations SET state='CHECKING' WHERE id=?")
    .run(runId);
  expect(await discoverAdditionalContributions(f.env, runId)).toEqual({
    status: 'UNAVAILABLE',
    candidateIds: [],
  });
  f.sql.close();
});
