import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { activateReservation } from '../src/competition-issues';
import type { Env } from '../src/env';

const frozenHash = 'a'.repeat(64);
const currentHash = 'b'.repeat(64);
const teamId = 'team-a';
const repositoryId = 7;
const issueNumber = 17;
const assignmentId = 'assignment-1';
const definitionSnapshot = {
  repository_id: repositoryId,
  issue_number: issueNumber,
  current_contract_hash: frozenHash,
  ownership: 'EXCLUSIVE',
  claimable: 0,
  capacity: 1,
  availability: 'AVAILABLE',
  eligible_teams: JSON.stringify([teamId]),
  evaluation_kind: 'MANDATORY',
};

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE hackathons(id TEXT PRIMARY KEY,name TEXT,status TEXT,policy TEXT,taxonomy TEXT);
    CREATE TABLE teams(id TEXT PRIMARY KEY,name TEXT,hackathon_id TEXT,status TEXT);
    CREATE TABLE github_repositories(id INTEGER PRIMARY KEY,full_name TEXT,accessible INTEGER);
    CREATE TABLE team_repositories(team_id TEXT,repository_id INTEGER,active INTEGER,PRIMARY KEY(team_id,repository_id));
    CREATE TABLE contracts(hash TEXT PRIMARY KEY,repository_id INTEGER,document TEXT);
    CREATE TABLE challenge_versions(contract_hash TEXT,repository_id INTEGER,issue_number INTEGER);
    CREATE TABLE github_issues(repository_id INTEGER,number INTEGER,source TEXT,classification TEXT,overrides TEXT,review_status TEXT,official INTEGER,github_state TEXT,labels TEXT,PRIMARY KEY(repository_id,number));
    CREATE TABLE challenge_definitions(repository_id INTEGER,issue_number INTEGER,current_contract_hash TEXT,ownership TEXT,claimable INTEGER,capacity INTEGER,availability TEXT,eligible_teams TEXT,evaluation_kind TEXT,PRIMARY KEY(repository_id,issue_number));
    CREATE TABLE issue_assignments(id TEXT PRIMARY KEY,team_id TEXT,repository_id INTEGER,issue_number INTEGER,contract_hash TEXT,exclusive INTEGER,source TEXT,status TEXT,progress TEXT,policy_snapshot TEXT,actor TEXT,expires_at TEXT,revoked_at TEXT);
    CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT,entity TEXT,actor TEXT,changes TEXT);
    CREATE TABLE github_sync_actions(id TEXT PRIMARY KEY,repository_id INTEGER,issue_number INTEGER,kind TEXT,document TEXT,status TEXT DEFAULT 'PENDING');
  `);
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
          const rows = sql.prepare(query).all(...(values as never[]));
          return { results: rows as T[] };
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
  type ReturnTypeDB = typeof DB;
  function DBPrepare() {
    return DB.prepare('SELECT 1');
  }
  void (null as unknown as ReturnTypeDB);
  sql
    .prepare('INSERT INTO hackathons VALUES(?,?,?,?,?)')
    .run('initial', 'Event', 'ACTIVE', '{}', '[]');
  sql
    .prepare('INSERT INTO github_repositories VALUES(?,?,1)')
    .run(repositoryId, 'example/repo');
  sql
    .prepare('INSERT INTO teams VALUES(?,?,?,?)')
    .run(teamId, 'Team A', 'initial', 'ACTIVE');
  sql
    .prepare('INSERT INTO team_repositories VALUES(?,?,1)')
    .run(teamId, repositoryId);
  sql
    .prepare('INSERT INTO contracts VALUES(?,?,?)')
    .run(frozenHash, repositoryId, '{}');
  sql
    .prepare('INSERT INTO contracts VALUES(?,?,?)')
    .run(currentHash, repositoryId, '{}');
  sql
    .prepare('INSERT INTO challenge_versions VALUES(?,?,?)')
    .run(frozenHash, repositoryId, issueNumber);
  sql
    .prepare('INSERT INTO github_issues VALUES(?,?,?,?,?,?,?,?,?)')
    .run(
      repositoryId,
      issueNumber,
      'ORGANIZER',
      JSON.stringify({ flags: [] }),
      '{}',
      'APPROVED',
      1,
      'open',
      '[]',
    );
  sql
    .prepare('INSERT INTO challenge_definitions VALUES(?,?,?,?,?,?,?,?,?)')
    .run(
      repositoryId,
      issueNumber,
      currentHash,
      'EXCLUSIVE',
      0,
      1,
      'AVAILABLE',
      JSON.stringify([teamId]),
      'MANDATORY',
    );
  sql
    .prepare('INSERT INTO issue_assignments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      assignmentId,
      teamId,
      repositoryId,
      issueNumber,
      frozenHash,
      1,
      'ORGANIZER',
      'RESERVED',
      'ASSIGNED',
      JSON.stringify(definitionSnapshot),
      'organizer:1',
      new Date(Date.now() + 3600000).toISOString(),
      null,
    );
  return { sql, env: { ORG_DB: DB } as unknown as Env };
}

describe('reservation activation lifecycle with SQLite', () => {
  it('activates an eligible reservation without changing its frozen identity or expiry', async () => {
    const f = fixture();
    const before = f.sql
      .prepare('SELECT * FROM issue_assignments WHERE id=?')
      .get(assignmentId) as Record<string, unknown>;
    await activateReservation(f.env, 'organizer:7', assignmentId);
    const after = f.sql
      .prepare('SELECT * FROM issue_assignments WHERE id=?')
      .get(assignmentId) as Record<string, unknown>;
    expect(after).toMatchObject({
      status: 'ACTIVE',
      contract_hash: frozenHash,
      policy_snapshot: JSON.stringify(definitionSnapshot),
      expires_at: before.expires_at,
      id: assignmentId,
    });
    expect(
      f.sql
        .prepare(
          "SELECT action,actor FROM audit WHERE action='assignment.reservation.activated'",
        )
        .get(),
    ).toEqual({
      action: 'assignment.reservation.activated',
      actor: 'organizer:7',
    });
    expect(
      f.sql
        .prepare(
          'SELECT repository_id,issue_number,kind FROM github_sync_actions',
        )
        .get(),
    ).toEqual({
      repository_id: repositoryId,
      issue_number: issueNumber,
      kind: 'LABELS',
    });
    expect(
      f.sql
        .prepare('SELECT id FROM github_sync_actions WHERE document=?')
        .get('{"labels":[]}'),
    ).toBeDefined();
  });

  it('preserves a valid frozen contract when the organizer publishes a newer version', async () => {
    const f = fixture();
    f.sql
      .prepare('UPDATE challenge_definitions SET eligible_teams=?')
      .run(JSON.stringify(['other-team']));
    await activateReservation(f.env, 'organizer:7', assignmentId);
    expect(
      f.sql
        .prepare(
          'SELECT contract_hash,policy_snapshot FROM issue_assignments WHERE id=?',
        )
        .get(assignmentId),
    ).toMatchObject({
      contract_hash: frozenHash,
      policy_snapshot: JSON.stringify(definitionSnapshot),
    });
  });

  it('rejects missing, non-reserved and already expired reservations without audit or sync', async () => {
    const f = fixture();
    await expect(
      activateReservation(f.env, 'organizer:7', 'missing'),
    ).rejects.toThrow();
    f.sql
      .prepare("UPDATE issue_assignments SET status='REVOKED' WHERE id=?")
      .run(assignmentId);
    await expect(
      activateReservation(f.env, 'organizer:7', assignmentId),
    ).rejects.toThrow();
    f.sql
      .prepare(
        "UPDATE issue_assignments SET status='RESERVED',expires_at='2000-01-01T00:00:00Z' WHERE id=?",
      )
      .run(assignmentId);
    await expect(
      activateReservation(f.env, 'organizer:7', assignmentId),
    ).rejects.toThrow();
    expect(
      f.sql.prepare('SELECT count(*) AS n FROM audit').get(),
    ).toMatchObject({ n: 0 });
    expect(
      f.sql.prepare('SELECT count(*) AS n FROM github_sync_actions').get(),
    ).toMatchObject({ n: 0 });
  });

  it('requires an active event, team and repository eligibility plus an approved open challenge', async () => {
    for (const change of [
      "UPDATE hackathons SET status='PAUSED'",
      "UPDATE teams SET status='WITHDRAWN'",
      'UPDATE team_repositories SET active=0',
      'UPDATE github_repositories SET accessible=0',
      "UPDATE github_issues SET github_state='closed'",
      'UPDATE github_issues SET official=0',
      "UPDATE github_issues SET review_status='REJECTED'",
      "UPDATE challenge_definitions SET availability='BLOCKED'",
      "UPDATE challenge_definitions SET availability='ARCHIVED'",
    ]) {
      const f = fixture();
      f.sql.exec(change);
      await expect(
        activateReservation(f.env, 'organizer:7', assignmentId),
      ).rejects.toThrow();
      expect(
        f.sql
          .prepare('SELECT status FROM issue_assignments WHERE id=?')
          .get(assignmentId),
      ).toMatchObject({ status: 'RESERVED' });
      expect(
        f.sql.prepare('SELECT count(*) AS n FROM audit').get(),
      ).toMatchObject({ n: 0 });
    }
  });

  it('rejects malformed frozen policy and a missing frozen contract without rebinding', async () => {
    const badSnapshot = fixture();
    badSnapshot.sql
      .prepare('UPDATE issue_assignments SET policy_snapshot=? WHERE id=?')
      .run(
        JSON.stringify({
          ...definitionSnapshot,
          eligible_teams: JSON.stringify(['other']),
        }),
        assignmentId,
      );
    await expect(
      activateReservation(badSnapshot.env, 'organizer:7', assignmentId),
    ).rejects.toThrow();
    const noContract = fixture();
    noContract.sql
      .prepare('DELETE FROM contracts WHERE hash=?')
      .run(frozenHash);
    await expect(
      activateReservation(noContract.env, 'organizer:7', assignmentId),
    ).rejects.toThrow();
    expect(
      noContract.sql
        .prepare('SELECT contract_hash FROM issue_assignments WHERE id=?')
        .get(assignmentId),
    ).toMatchObject({ contract_hash: frozenHash });
  });

  it('allows RESERVED challenge availability while retaining the original challenge version', async () => {
    const f = fixture();
    f.sql
      .prepare("UPDATE challenge_definitions SET availability='RESERVED'")
      .run();
    await activateReservation(f.env, 'organizer:7', assignmentId);
    expect(
      f.sql
        .prepare(
          'SELECT status,contract_hash FROM issue_assignments WHERE id=?',
        )
        .get(assignmentId),
    ).toMatchObject({ status: 'ACTIVE', contract_hash: frozenHash });
  });

  it('audits only the winning transition under duplicate activation and a revoke race', async () => {
    const f = fixture();
    await activateReservation(f.env, 'organizer:7', assignmentId);
    await expect(
      activateReservation(f.env, 'organizer:8', assignmentId),
    ).rejects.toThrow();
    expect(
      f.sql
        .prepare(
          "SELECT count(*) AS n FROM audit WHERE action='assignment.reservation.activated'",
        )
        .get(),
    ).toMatchObject({ n: 1 });
    const raced = fixture();
    raced.sql
      .prepare("UPDATE issue_assignments SET status='REVOKED' WHERE id=?")
      .run(assignmentId);
    await expect(
      activateReservation(raced.env, 'organizer:8', assignmentId),
    ).rejects.toThrow();
    expect(
      raced.sql
        .prepare(
          "SELECT count(*) AS n FROM audit WHERE action='assignment.reservation.activated'",
        )
        .get(),
    ).toMatchObject({ n: 0 });
    expect(
      raced.sql.prepare('SELECT count(*) AS n FROM github_sync_actions').get(),
    ).toMatchObject({ n: 0 });
  });
});
