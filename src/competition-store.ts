import { canonical, contractSchema, digest, type Contract } from './domain';
import {
  defaultTaxonomy,
  eventPolicySchema,
  taxonomySchema,
  type GitHubIdentity,
} from './competition-domain';
import type { Env } from './env';
import type { GitHub } from './github';
export interface CompetitionServices {
  capabilities?(): Promise<{
    app?: ReturnType<typeof import('./github-app-access').appAccess>;
    issuesWrite: boolean;
    events: string[];
    reason?: string;
  }>;
  client(repositoryId?: number, write?: boolean): Promise<GitHub>;
  evaluationEnv(): Promise<Env>;
  installationId(): Promise<number>;
  appSlug(): Promise<string>;
}
export function competitionDB(env: Env) {
  if (!env.ORG_DB) throw new Error('ORGANIZATION_NOT_CONFIGURED');
  return env.ORG_DB;
}
export async function eventSettings(env: Env) {
  const row = await competitionDB(env)
    .prepare('SELECT * FROM hackathons WHERE id=?')
    .bind('initial')
    .first<{
      id: string;
      name: string;
      status: string;
      policy: string;
      taxonomy: string;
    }>();
  if (!row) throw new Error('HACKATHON_NOT_CONFIGURED');
  const configured = JSON.parse(row.taxonomy);
  return {
    ...row,
    policy: eventPolicySchema.parse(JSON.parse(row.policy)),
    taxonomy: taxonomySchema.parse(
      configured.length ? configured : defaultTaxonomy,
    ),
  };
}
export function auditStatement(
  env: Env,
  actor: string,
  action: string,
  entity: string,
  before: unknown,
  after: unknown,
) {
  return competitionDB(env)
    .prepare('INSERT INTO audit(action,entity,actor,changes) VALUES(?,?,?,?)')
    .bind(action, entity, actor, canonical({ before, after }));
}
export async function selectedRepository(env: Env, id: number) {
  const repo = await competitionDB(env)
    .prepare(
      'SELECT id,full_name,default_branch FROM github_repositories WHERE id=? AND accessible=1',
    )
    .bind(id)
    .first<{ id: number; full_name: string; default_branch: string }>();
  if (!repo) throw new Error('REPOSITORY_NOT_INSTALLED');
  return repo;
}
export async function verifyIdentity(
  client: GitHub,
  login: string,
): Promise<GitHubIdentity> {
  const identity = await client.api<{
    id: number;
    login: string;
    type: string;
  }>('/users/' + encodeURIComponent(login.replace(/^@/, '')));
  if (
    !Number.isSafeInteger(identity.id) ||
    identity.id <= 0 ||
    identity.type !== 'User' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(identity.login)
  )
    throw new Error('INVALID_GITHUB_IDENTITY');
  return { id: identity.id, login: identity.login };
}
export async function eligibleTeam(
  env: Env,
  teamId: string,
  repositoryId: number,
) {
  const db = competitionDB(env);
  const team = await db
    .prepare(
      "SELECT t.* FROM teams t JOIN team_repositories r ON r.team_id=t.id WHERE t.id=? AND t.hackathon_id='initial' AND t.status='ACTIVE' AND r.repository_id=? AND r.active=1",
    )
    .bind(teamId, repositoryId)
    .first<{ id: string; name: string }>();
  if (!team) throw new Error('TEAM_NOT_ELIGIBLE_FOR_REPOSITORY');
  return team;
}
export async function registerContract(
  env: Env,
  services: CompetitionServices,
  document: unknown,
) {
  const c = contractSchema.parse(document),
    repo = await selectedRepository(env, c.repository.id);
  if (
    c.repository.fullName !== repo.full_name ||
    c.repository.installationId !== (await services.installationId())
  )
    throw new Error('CONTRACT_REPOSITORY_MISMATCH');
  const text = canonical(c),
    hash = await digest(text),
    db = competitionDB(env);
  await db.batch([
    db
      .prepare(
        'INSERT INTO repositories(id,full_name,installation_id,active_contract_hash) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',
      )
      .bind(repo.id, repo.full_name, c.repository.installationId, hash),
    db
      .prepare(
        'INSERT OR IGNORE INTO contracts(hash,repository_id,document) VALUES(?,?,?)',
      )
      .bind(hash, repo.id, text),
  ]);
  return { hash, contract: c };
}
export async function registerNeutralRepository(
  env: Env,
  services: CompetitionServices,
  id: number,
) {
  const repo = await selectedRepository(env, id);
  await competitionDB(env)
    .prepare(
      'INSERT OR IGNORE INTO repositories(id,full_name,installation_id,active_contract_hash) VALUES(?,?,?,?)',
    )
    .bind(repo.id, repo.full_name, await services.installationId(), '')
    .run();
  return repo;
}
export async function combinedContract(
  env: Env,
  assignmentRows: { contract_hash: string; issue_number: number }[],
): Promise<{ hash: string; contract: Contract }> {
  if (!assignmentRows.length) throw new Error('ISSUE_ASSIGNMENT_REQUIRED');
  const db = competitionDB(env),
    documents: Contract[] = [];
  for (const row of assignmentRows) {
    const record = await db
      .prepare('SELECT document FROM contracts WHERE hash=?')
      .bind(row.contract_hash)
      .first<{ document: string }>();
    if (!record) throw new Error('CONTRACT_NOT_FOUND');
    documents.push(contractSchema.parse(JSON.parse(record.document)));
  }
  const first = documents[0]!;
  if (
    documents.some(
      (c) =>
        c.baseline !== first.baseline ||
        canonical(c.execution) !== canonical(first.execution) ||
        canonical(c.repository) !== canonical(first.repository),
    )
  )
    throw new Error('INCOMPATIBLE_ISSUE_CONTRACTS');
  if (documents.length === 1)
    return { hash: assignmentRows[0]!.contract_hash, contract: first };
  const contract = contractSchema.parse({
    ...first,
    evaluationVersion:
      'combined-' +
      (
        await digest(canonical(assignmentRows.map((a) => a.contract_hash)))
      ).slice(0, 24),
    challengeVersion: 'assigned-versions',
    issueNumbers: assignmentRows.map((a) => a.issue_number),
    requirements: documents.flatMap((c, i) =>
      c.requirements.map((r) => ({
        ...r,
        id: 'i' + assignmentRows[i]!.issue_number + '-' + r.id,
        criteria: r.criteria.map((k) => ({
          ...k,
          id: 'i' + assignmentRows[i]!.issue_number + '-' + k.id,
        })),
      })),
    ),
    constraints: [...new Set(documents.flatMap((c) => c.constraints))],
    forbiddenPaths: [...new Set(documents.flatMap((c) => c.forbiddenPaths))],
    additionalCategories: [
      ...new Set(documents.flatMap((c) => c.additionalCategories)),
    ],
    expectedArtifacts: documents.some((c) => c.expectedArtifacts !== undefined)
      ? documents.flatMap((c, index) =>
          (c.expectedArtifacts ?? []).map((artifact) => ({
            ...artifact,
            id: 'i' + assignmentRows[index]!.issue_number + '-' + artifact.id,
          })),
        )
      : undefined,
  });
  const text = canonical(contract),
    hash = await digest(text);
  await db
    .prepare(
      'INSERT OR IGNORE INTO contracts(hash,repository_id,document) VALUES(?,?,?)',
    )
    .bind(hash, first.repository.id, text)
    .run();
  return { hash, contract };
}
