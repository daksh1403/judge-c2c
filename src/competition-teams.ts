import { prepareAssignment } from './competition-issues';
import { z } from 'zod';
import { canonical } from './domain';
import {
  teamCreateSchema,
  teamUpdateSchema,
  memberSchema,
  parseTeamCSV,
  type GitHubIdentity,
} from './competition-domain';
import {
  auditStatement,
  competitionDB,
  eventSettings,
  selectedRepository,
  verifyIdentity,
  type CompetitionServices,
} from './competition-store';
import type { Env } from './env';
export async function createTeam(
  env: Env,
  services: CompetitionServices,
  actor: string,
  raw: unknown,
  commit = true,
) {
  const data = teamCreateSchema.parse(raw),
    settings = await eventSettings(env),
    db = competitionDB(env);
  if (
    data.repositoryIds.length > settings.policy.maxRepositoriesPerTeam ||
    new Set(data.repositoryIds).size !== data.repositoryIds.length
  )
    throw new Error('TEAM_REPOSITORY_LIMIT');
  const client = await services.client(),
    identities: GitHubIdentity[] = [];
  for (const member of data.members)
    identities.push(await verifyIdentity(client, member.githubLogin));
  if (new Set(identities.map((i) => i.id)).size !== identities.length)
    throw new Error('DUPLICATE_GITHUB_IDENTITY');
  for (const identity of identities) {
    const conflict = await db
      .prepare(
        "SELECT team_id FROM team_members WHERE hackathon_id='initial' AND github_id=? AND active=1",
      )
      .bind(identity.id)
      .first();
    if (conflict) throw new Error('GITHUB_IDENTITY_ALREADY_ASSIGNED');
  }
  for (const id of data.repositoryIds) await selectedRepository(env, id);
  const id = 'team-' + crypto.randomUUID(),
    team = {
      id,
      ...data,
      members: data.members.map((m, i) => ({
        ...m,
        githubId: identities[i]!.id,
        githubLogin: identities[i]!.login,
      })),
    };
  if (commit) await db.batch(teamInsertStatements(env, actor, team));
  return team;
}
export function teamInsertStatements(
  env: Env,
  actor: string,
  team: Awaited<ReturnType<typeof createTeam>>,
) {
  const db = competitionDB(env);
  return [
    db
      .prepare(
        "INSERT INTO teams(id,name,hackathon_id,status,metadata,registration_source,created_at,updated_at) VALUES(?,?,'initial',?,?,'organizer',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
      )
      .bind(team.id, team.name, team.status, canonical(team.metadata)),
    ...team.members.map((m) =>
      db
        .prepare(
          "INSERT INTO team_members(id,team_id,hackathon_id,github_id,github_login,display_name,email,external_id) VALUES(?,?,'initial',?,?,?,?,?)",
        )
        .bind(
          'member-' + crypto.randomUUID(),
          team.id,
          m.githubId,
          m.githubLogin,
          m.displayName,
          m.email ?? null,
          m.externalId ?? null,
        ),
    ),
    ...team.repositoryIds.map((repositoryId) =>
      db
        .prepare(
          'INSERT INTO team_repositories(team_id,repository_id,actor) VALUES(?,?,?)',
        )
        .bind(team.id, repositoryId, actor),
    ),
    auditStatement(env, actor, 'team.created', team.id, null, team),
  ];
}
export async function changeTeam(
  env: Env,
  actor: string,
  id: string,
  raw: unknown,
) {
  const data = teamUpdateSchema.parse(raw),
    db = competitionDB(env),
    before = await db
      .prepare('SELECT * FROM teams WHERE id=?')
      .bind(id)
      .first<{ name: string; status: string; metadata: string }>();
  if (!before) throw new Error('TEAM_NOT_FOUND');
  const after = {
    name: data.name ?? before.name,
    status: data.status ?? before.status,
    metadata: data.metadata ?? JSON.parse(before.metadata),
  };
  await db.batch([
    db
      .prepare(
        'UPDATE teams SET name=?,status=?,metadata=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      )
      .bind(after.name, after.status, canonical(after.metadata), id),
    ...(after.status !== 'ACTIVE'
      ? [
          db
            .prepare(
              "UPDATE evaluations SET state='SUPERSEDED',updated_at=CURRENT_TIMESTAMP WHERE state NOT IN('COMPLETED','FAILED','SUPERSEDED') AND json_extract(assignment_snapshot,'$.team_id')=?",
            )
            .bind(id),
        ]
      : []),
    auditStatement(env, actor, 'team.updated', id, before, after),
  ]);
  return after;
}
export async function addMember(
  env: Env,
  services: CompetitionServices,
  actor: string,
  teamId: string,
  raw: unknown,
  replaceId?: string,
) {
  const member = memberSchema.parse(raw),
    db = competitionDB(env),
    team = await db
      .prepare('SELECT id FROM teams WHERE id=?')
      .bind(teamId)
      .first();
  if (!team) throw new Error('TEAM_NOT_FOUND');
  const identity = await verifyIdentity(
      await services.client(),
      member.githubLogin,
    ),
    id = 'member-' + crypto.randomUUID();
  const previous = replaceId
    ? await db
        .prepare(
          'SELECT * FROM team_members WHERE id=? AND team_id=? AND active=1',
        )
        .bind(replaceId, teamId)
        .first()
    : null;
  if (replaceId && !previous) throw new Error('MEMBER_NOT_FOUND');
  await db.batch([
    ...(replaceId
      ? [
          db
            .prepare(
              'UPDATE team_members SET active=0,removed_at=CURRENT_TIMESTAMP WHERE id=? AND team_id=?',
            )
            .bind(replaceId, teamId),
        ]
      : []),
    db
      .prepare(
        "INSERT INTO team_members(id,team_id,hackathon_id,github_id,github_login,display_name,email,external_id) VALUES(?,?,'initial',?,?,?,?,?)",
      )
      .bind(
        id,
        teamId,
        identity.id,
        identity.login,
        member.displayName,
        member.email ?? null,
        member.externalId ?? null,
      ),
    auditStatement(
      env,
      actor,
      replaceId ? 'team.identity.changed' : 'team.member.added',
      teamId,
      previous,
      { id, ...member, githubId: identity.id },
    ),
  ]);
  return { id, githubId: identity.id, githubLogin: identity.login };
}
export async function removeMember(
  env: Env,
  actor: string,
  teamId: string,
  id: string,
) {
  const db = competitionDB(env),
    before = await db
      .prepare(
        'SELECT * FROM team_members WHERE id=? AND team_id=? AND active=1',
      )
      .bind(id, teamId)
      .first();
  if (!before) throw new Error('MEMBER_NOT_FOUND');
  await db.batch([
    db
      .prepare(
        'UPDATE team_members SET active=0,removed_at=CURRENT_TIMESTAMP WHERE id=? AND team_id=?',
      )
      .bind(id, teamId),
    auditStatement(env, actor, 'team.member.removed', teamId, before, null),
  ]);
}
export async function assignRepository(
  env: Env,
  actor: string,
  teamId: string,
  repositoryId: number,
  remove = false,
) {
  const db = competitionDB(env),
    settings = await eventSettings(env);
  await selectedRepository(env, repositoryId);
  if (
    !(await db.prepare('SELECT id FROM teams WHERE id=?').bind(teamId).first())
  )
    throw new Error('TEAM_NOT_FOUND');
  if (
    remove &&
    (await db
      .prepare(
        "SELECT id FROM issue_assignments WHERE team_id=? AND repository_id=? AND status IN('ACTIVE','RESERVED') LIMIT 1",
      )
      .bind(teamId, repositoryId)
      .first())
  )
    throw new Error('ACTIVE_ISSUE_ASSIGNMENTS_REQUIRE_REVOCATION');
  const operation = remove
    ? db
        .prepare(
          'UPDATE team_repositories SET active=0 WHERE team_id=? AND repository_id=?',
        )
        .bind(teamId, repositoryId)
    : db
        .prepare(
          'INSERT INTO team_repositories(team_id,repository_id,actor) SELECT ?,?,? WHERE (SELECT count(*) FROM team_repositories WHERE team_id=? AND active=1)<? OR EXISTS(SELECT 1 FROM team_repositories WHERE team_id=? AND repository_id=? AND active=1) ON CONFLICT(team_id,repository_id) DO UPDATE SET active=1,actor=excluded.actor,assigned_at=CURRENT_TIMESTAMP',
        )
        .bind(
          teamId,
          repositoryId,
          actor,
          teamId,
          settings.policy.maxRepositoriesPerTeam,
          teamId,
          repositoryId,
        );
  const results = await db.batch([
    operation,
    db
      .prepare(
        'INSERT INTO audit(action,entity,actor,changes) VALUES(?,CASE WHEN changes()>0 THEN ? ELSE NULL END,?,?)',
      )
      .bind(
        remove ? 'team.repository.revoked' : 'team.repository.assigned',
        teamId,
        actor,
        canonical({ before: null, after: { repositoryId } }),
      ),
  ]);
  if (!results[0]?.meta.changes) throw new Error('TEAM_REPOSITORY_LIMIT');
}
export async function importTeams(
  env: Env,
  services: CompetitionServices,
  actor: string,
  raw: unknown,
) {
  const data = z
      .object({
        csv: z.string().max(100000).optional(),
        teams: z.array(teamCreateSchema).max(100).optional(),
        commit: z.boolean().default(false),
      })
      .strict()
      .refine((x) => Boolean(x.csv) !== Boolean(x.teams))
      .parse(raw),
    db = competitionDB(env);
  const parsed = data.csv ? parseTeamCSV(data.csv) : data.teams!;
  const prepared: Awaited<ReturnType<typeof createTeam>>[] = [],
    issues: { teamId: string; repositoryId: number; issueNumber: number }[] =
      [];
  for (const input of parsed) {
    const teamInput = { ...input };
    if ('initialIssues' in teamInput) {
      const repositories = await db
        .prepare(
          'SELECT id,full_name FROM github_repositories WHERE accessible=1',
        )
        .all<{ id: number; full_name: string }>();
      const names =
        (teamInput as unknown as { repositoryNames?: string[] })
          .repositoryNames ?? [];
      teamInput.repositoryIds = [...names].map((name) => {
        const repo = repositories.results.find(
          (r) => r.full_name.toLowerCase() === name.toLowerCase(),
        );
        if (!repo) throw new Error('IMPORT_REPOSITORY_NOT_INSTALLED');
        return repo.id;
      });
      const initial = (
        teamInput as unknown as {
          initialIssues: { repository: string; issueNumber: number }[];
        }
      ).initialIssues;
      delete (teamInput as Record<string, unknown>).initialIssues;
      delete (teamInput as Record<string, unknown>).repositoryNames;
      for (const issue of initial) {
        const repository = repositories.results.find(
          (r) => r.full_name.toLowerCase() === issue.repository.toLowerCase(),
        );
        if (!repository) throw new Error('IMPORT_REPOSITORY_NOT_INSTALLED');
        issues.push({
          teamId: '',
          repositoryId: repository.id,
          issueNumber: issue.issueNumber,
        });
      }
    }
    if (
      await db
        .prepare(
          "SELECT id FROM teams WHERE hackathon_id='initial' AND lower(name)=lower(?)",
        )
        .bind(input.name)
        .first()
    )
      throw new Error('IMPORT_TEAM_NAME_ALREADY_EXISTS');
    const team = await createTeam(env, services, actor, teamInput, false);
    for (const issue of issues.filter((x) => !x.teamId)) issue.teamId = team.id;
    prepared.push(team);
  }
  const identities = prepared.flatMap((t) => t.members.map((m) => m.githubId));
  if (new Set(identities).size !== identities.length)
    throw new Error('IMPORT_CONFLICTING_GITHUB_IDENTITIES');
  const initialStatements: D1PreparedStatement[] = [];
  for (const issue of issues) {
    if (prepared.find((t) => t.id === issue.teamId)?.status !== 'ACTIVE')
      throw new Error('IMPORT_INITIAL_ISSUES_REQUIRE_ACTIVE_APPROVED_TEAMS');
    const assignment = await prepareAssignment(env, actor, issue, 'IMPORT');
    initialStatements.push(...assignment.statements);
  }
  if (data.commit)
    await db.batch([
      ...prepared.flatMap((team) => teamInsertStatements(env, actor, team)),
      ...initialStatements,
      auditStatement(env, actor, 'teams.imported', 'initial', null, {
        teamIds: prepared.map((t) => t.id),
      }),
    ]);
  return { dryRun: !data.commit, teams: prepared };
}
