import { z } from 'zod';
import { canonical, contractSchema, digest } from './domain';
import { redact } from './security';
import {
  assignmentInput,
  classifyIssue,
  possibleDuplicates,
  reviewIssueSchema,
} from './competition-domain';
import {
  auditStatement,
  competitionDB,
  eventSettings,
  selectedRepository,
  registerContract,
  type CompetitionServices,
} from './competition-store';
import type { Env } from './env';
export const officialChallengeSchema = z
  .object({
    repositoryId: z.number().int().positive(),
    issueNumber: z.number().int().positive(),
    contract: contractSchema,
    ownership: z.enum(['EXCLUSIVE', 'SHARED']).default('EXCLUSIVE'),
    claimable: z.boolean().default(false),
    capacity: z.number().int().min(1).max(1000).default(1),
    availability: z
      .enum(['AVAILABLE', 'RESERVED', 'BLOCKED', 'ARCHIVED'])
      .default('AVAILABLE'),
    eligibleTeams: z.array(z.string().max(80)).max(1000).default([]),
    evaluationKind: z
      .enum(['MANDATORY', 'OPTIONAL', 'BONUS', 'NOT_SCORED'])
      .default('MANDATORY'),
  })
  .strict()
  .refine(
    (x) => x.ownership !== 'EXCLUSIVE' || x.capacity === 1,
    'Exclusive challenges have one owner',
  );
export async function syncIssue(
  env: Env,
  services: CompetitionServices,
  repositoryId: number,
  number: number,
  actor = 'system',
) {
  const db = competitionDB(env),
    repo = await selectedRepository(env, repositoryId),
    settings = await eventSettings(env);
  const native = await (
    await services.client(repositoryId)
  ).api<{
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    user: { id: number; login: string };
    labels: { name: string }[];
    updated_at: string;
    created_at?: string;
    pull_request?: unknown;
    assignees?: { id: number; login: string }[];
  }>(`/repos/${repo.full_name}/issues/${number}`);
  if (
    native.pull_request ||
    native.number !== number ||
    native.title.length > 1000 ||
    (native.body?.length ?? 0) > 50000 ||
    !Number.isSafeInteger(native.user.id)
  )
    throw new Error('ISSUE_CONTEXT_INVALID');
  const previous = await db
    .prepare('SELECT * FROM github_issues WHERE repository_id=? AND number=?')
    .bind(repositoryId, number)
    .first<{
      source: string;
      reporter_team_id: string | null;
      classification: string;
      overrides: string;
      github_updated_at: string;
    }>();
  const member = await db
    .prepare(
      "SELECT m.team_id FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.github_id=? AND m.hackathon_id='initial' AND m.active=1 AND t.status='ACTIVE'",
    )
    .bind(native.user.id)
    .first<{ team_id: string }>();
  const source =
    previous?.source && previous.source !== 'UNKNOWN'
      ? previous.source
      : settings.policy.organizerGitHubIds.includes(native.user.id)
        ? 'ORGANIZER'
        : member
          ? 'PARTICIPANT'
          : 'UNKNOWN';
  const labels = native.labels.map((l) => l.name).slice(0, 100),
    types = settings.taxonomy
      .filter((l) => l.name.startsWith('judge:type:'))
      .map((l) => l.name.slice(11));
  const classification = {
    ...classifyIssue(native.title, native.body ?? '', labels, types),
    appliedLabels:
      JSON.parse(previous?.classification ?? '{}').appliedLabels ?? [],
    ...JSON.parse(previous?.overrides ?? '{}'),
  };
  const candidates = await db
    .prepare(
      'SELECT number,title FROM github_issues WHERE repository_id=? AND number<>? ORDER BY updated_at DESC LIMIT 500',
    )
    .bind(repositoryId, number)
    .all<{ number: number; title: string }>();
  const duplicates = possibleDuplicates(native.title, candidates.results);
  if (duplicates.length && !classification.flags.includes('possible-duplicate'))
    classification.flags.push('possible-duplicate');
  const recent = await db
    .prepare(
      "SELECT count(*) AS n FROM github_issues WHERE author_id=? AND repository_id=? AND number<>? AND datetime(json_extract(classification,'$.nativeCreatedAt'))>=datetime('now','-1 hour')",
    )
    .bind(native.user.id, repositoryId, number)
    .first<{ n: number }>();
  if (
    native.created_at &&
    Date.parse(native.created_at) >= Date.now() - 3600000 &&
    (recent?.n ?? 0) >= 20
  )
    classification.flags.push('possible-spam');
  const snapshotHash = await digest(canonical(native));
  const stored = {
    title: redact(native.title),
    body: redact(native.body ?? ''),
    source,
    reporterTeamId: previous?.reporter_team_id ?? member?.team_id ?? null,
    classification: {
      ...classification,
      possibleDuplicates: duplicates,
      nativeAssignees: native.assignees ?? [],
      nativeCreatedAt: native.created_at ?? null,
    },
    labels,
    githubState: native.state,
    snapshotHash,
  };
  await db.batch([
    db
      .prepare(
        'INSERT INTO github_issues(repository_id,number,title,body,github_state,author_id,author_login,reporter_team_id,source,labels,classification,github_updated_at,snapshot_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(repository_id,number) DO UPDATE SET title=excluded.title,body=excluded.body,github_state=excluded.github_state,author_login=excluded.author_login,reporter_team_id=excluded.reporter_team_id,source=excluded.source,labels=excluded.labels,classification=excluded.classification,github_updated_at=excluded.github_updated_at,snapshot_hash=excluded.snapshot_hash,updated_at=CURRENT_TIMESTAMP WHERE excluded.github_updated_at>=github_issues.github_updated_at',
      )
      .bind(
        repositoryId,
        number,
        stored.title,
        stored.body,
        native.state,
        native.user.id,
        native.user.login,
        stored.reporterTeamId,
        source,
        canonical(labels),
        canonical(stored.classification),
        native.updated_at,
        snapshotHash,
      ),
    auditStatement(
      env,
      actor,
      'issue.synchronized',
      repositoryId + ':' + number,
      previous,
      stored,
    ),
  ]);
  await queueIssueLabels(env, repositoryId, number);
  return stored;
}
export async function reviewIssue(
  env: Env,
  actor: string,
  repositoryId: number,
  number: number,
  raw: unknown,
) {
  const data = reviewIssueSchema.parse(raw),
    db = competitionDB(env),
    settings = await eventSettings(env),
    before = await db
      .prepare('SELECT * FROM github_issues WHERE repository_id=? AND number=?')
      .bind(repositoryId, number)
      .first<{ classification: string; overrides: string; official: number }>();
  if (!before) throw new Error('ISSUE_NOT_FOUND');
  if (
    data.type &&
    !settings.taxonomy.some((l) => l.name === 'judge:type:' + data.type)
  )
    throw new Error('TYPE_NOT_IN_TAXONOMY');
  if (
    data.reviewStatus === 'DUPLICATE' &&
    (!data.canonicalNumber ||
      data.canonicalNumber === number ||
      !(await db
        .prepare(
          'SELECT number FROM github_issues WHERE repository_id=? AND number=?',
        )
        .bind(repositoryId, data.canonicalNumber)
        .first()))
  )
    throw new Error('CANONICAL_ISSUE_REQUIRED');
  if (
    data.reviewStatus === 'RECOGNIZED' &&
    (settings.policy.discoveryCredit === 'NONE' || !data.recognition)
  )
    throw new Error('RECOGNITION_NOT_ALLOWED');
  const override = {
    ...JSON.parse(before.overrides),
    ...Object.fromEntries(
      ['type', 'priority', 'difficulty', 'severity']
        .filter((k) => k in data)
        .map((k) => [k, data[k as keyof typeof data]]),
    ),
    provenance: 'organizer',
    overrideActor: actor,
  };
  const classification = { ...JSON.parse(before.classification), ...override };
  await db.batch([
    db
      .prepare(
        'UPDATE github_issues SET review_status=?,classification=?,overrides=?,canonical_number=?,recognition=?,updated_at=CURRENT_TIMESTAMP WHERE repository_id=? AND number=?',
      )
      .bind(
        data.reviewStatus,
        canonical(classification),
        canonical(override),
        data.canonicalNumber ?? null,
        data.recognition ?? null,
        repositoryId,
        number,
      ),
    auditStatement(
      env,
      actor,
      'issue.reviewed',
      repositoryId + ':' + number,
      before,
      data,
    ),
  ]);
  await queueIssueLabels(env, repositoryId, number);
  return data;
}
export async function publishChallenge(
  env: Env,
  services: CompetitionServices,
  actor: string,
  raw: unknown,
) {
  const data = officialChallengeSchema.parse(raw),
    db = competitionDB(env),
    repo = await selectedRepository(env, data.repositoryId);
  if (
    data.contract.repository.id !== repo.id ||
    data.contract.issueNumbers.length !== 1 ||
    data.contract.issueNumbers[0] !== data.issueNumber
  )
    throw new Error('CHALLENGE_ISSUE_CONTRACT_MISMATCH');
  await syncIssue(env, services, repo.id, data.issueNumber, actor);
  const client = await services.client(repo.id),
    commit = await client.api<{ sha: string }>(
      `/repos/${repo.full_name}/commits/${data.contract.baseline}`,
    );
  if (commit.sha !== data.contract.baseline)
    throw new Error('BASELINE_NOT_FOUND');
  for (const teamId of data.eligibleTeams)
    if (
      !(await db
        .prepare('SELECT id FROM teams WHERE id=?')
        .bind(teamId)
        .first())
    )
      throw new Error('ELIGIBLE_TEAM_NOT_FOUND');
  const old = await db
    .prepare(
      'SELECT * FROM challenge_definitions WHERE repository_id=? AND issue_number=?',
    )
    .bind(repo.id, data.issueNumber)
    .first<{ ownership: string }>();
  if (
    old &&
    old.ownership !== data.ownership &&
    (await db
      .prepare(
        "SELECT id FROM issue_assignments WHERE repository_id=? AND issue_number=? AND status IN('ACTIVE','RESERVED')",
      )
      .bind(repo.id, data.issueNumber)
      .first())
  )
    throw new Error('REVOKE_ASSIGNMENTS_BEFORE_OWNERSHIP_CHANGE');
  const registered = await registerContract(env, services, {
    ...data.contract,
    evaluationVersion:
      'issue-' +
      data.issueNumber +
      '-' +
      (await digest(canonical(data))).slice(0, 32),
  });
  await db.batch([
    db
      .prepare(
        'INSERT OR IGNORE INTO challenge_versions(contract_hash,repository_id,issue_number,definition_snapshot,actor) VALUES(?,?,?,?,?)',
      )
      .bind(registered.hash, repo.id, data.issueNumber, canonical(data), actor),
    db
      .prepare(
        'INSERT INTO challenge_definitions(repository_id,issue_number,current_contract_hash,ownership,claimable,capacity,availability,eligible_teams,evaluation_kind) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(repository_id,issue_number) DO UPDATE SET current_contract_hash=excluded.current_contract_hash,ownership=excluded.ownership,claimable=excluded.claimable,capacity=excluded.capacity,availability=excluded.availability,eligible_teams=excluded.eligible_teams,evaluation_kind=excluded.evaluation_kind',
      )
      .bind(
        repo.id,
        data.issueNumber,
        registered.hash,
        data.ownership,
        Number(data.claimable),
        data.capacity,
        data.availability,
        canonical(data.eligibleTeams),
        data.evaluationKind,
      ),
    db
      .prepare(
        "UPDATE github_issues SET official=1,review_status='APPROVED',updated_at=CURRENT_TIMESTAMP WHERE repository_id=? AND number=?",
      )
      .bind(repo.id, data.issueNumber),
    auditStatement(
      env,
      actor,
      'challenge.version.published',
      repo.id + ':' + data.issueNumber,
      old,
      { ...data, contractHash: registered.hash },
    ),
  ]);
  await queueIssueLabels(env, repo.id, data.issueNumber);
  return { contractHash: registered.hash };
}
export function expirationStatements(
  env: Env,
  issue?: { repositoryId: number; issueNumber: number },
) {
  const db = competitionDB(env);
  const predicate =
    "status IN('ACTIVE','RESERVED') AND expires_at IS NOT NULL AND datetime(expires_at)<=CURRENT_TIMESTAMP" +
    (issue ? ' AND repository_id=? AND issue_number=?' : '');
  const scoped = (statement: D1PreparedStatement) =>
    issue ? statement.bind(issue.repositoryId, issue.issueNumber) : statement;
  return [
    scoped(
      db.prepare(
        `SELECT repository_id,issue_number FROM issue_assignments WHERE ${predicate}`,
      ),
    ),
    scoped(
      db.prepare(
        `INSERT INTO audit(action,entity,actor,changes) SELECT 'issue.assignment.expired',id,'system',json_object('before',json_object('status',status,'expiresAt',expires_at),'after',json_object('status','EXPIRED')) FROM issue_assignments WHERE ${predicate}`,
      ),
    ),
    scoped(
      db.prepare(
        `UPDATE issue_assignments SET status='EXPIRED',revoked_at=CURRENT_TIMESTAMP WHERE ${predicate}`,
      ),
    ),
  ];
}
export async function prepareAssignment(
  env: Env,
  actor: string,
  raw: unknown,
  source: 'ORGANIZER' | 'CLAIM' | 'IMPORT' = 'ORGANIZER',
) {
  const data = assignmentInput.parse(raw),
    db = competitionDB(env),
    settings = await eventSettings(env);
  if (settings.status !== 'ACTIVE') throw new Error('EVENT_INACTIVE');
  if (source === 'CLAIM' && !settings.policy.claimingEnabled)
    throw new Error('CLAIMING_DISABLED');
  if (data.expiresAt && Date.parse(data.expiresAt) <= Date.now())
    throw new Error('RESERVATION_EXPIRATION_INVALID');
  const definition = await db
    .prepare(
      "SELECT d.* FROM challenge_definitions d JOIN github_issues i ON i.repository_id=d.repository_id AND i.number=d.issue_number WHERE d.repository_id=? AND d.issue_number=? AND i.official=1 AND i.review_status='APPROVED' AND i.github_state='open'",
    )
    .bind(data.repositoryId, data.issueNumber)
    .first<{
      current_contract_hash: string;
      ownership: string;
      claimable: number;
      capacity: number;
      availability: string;
      eligible_teams: string;
    }>();
  if (
    !definition ||
    definition.availability !== 'AVAILABLE' ||
    (source === 'CLAIM' && !definition.claimable)
  )
    throw new Error('ISSUE_NOT_AVAILABLE');
  const restricted = JSON.parse(definition.eligible_teams) as string[];
  if (restricted.length && !restricted.includes(data.teamId))
    throw new Error('TEAM_NOT_ELIGIBLE_FOR_ISSUE');
  const id = 'assignment-' + crypto.randomUUID(),
    status = data.reservation ? 'RESERVED' : 'ACTIVE';
  const statements = [
    ...expirationStatements(env, data).slice(1),
    db
      .prepare(
        "INSERT INTO issue_assignments(id,team_id,repository_id,issue_number,contract_hash,exclusive,source,status,policy_snapshot,actor,expires_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM teams t JOIN team_repositories r ON t.id=r.team_id WHERE t.id=? AND t.status='ACTIVE' AND r.repository_id=? AND r.active=1) AND EXISTS(SELECT 1 FROM challenge_definitions WHERE repository_id=? AND issue_number=? AND current_contract_hash=? AND availability='AVAILABLE' AND EXISTS(SELECT 1 FROM github_issues i WHERE i.repository_id=challenge_definitions.repository_id AND i.number=challenge_definitions.issue_number AND i.official=1 AND i.review_status='APPROVED' AND i.github_state='open')) AND EXISTS(SELECT 1 FROM hackathons WHERE id='initial' AND status='ACTIVE') AND (SELECT count(*) FROM issue_assignments WHERE repository_id=? AND issue_number=? AND status IN('ACTIVE','RESERVED'))<?",
      )
      .bind(
        id,
        data.teamId,
        data.repositoryId,
        data.issueNumber,
        definition.current_contract_hash,
        Number(definition.ownership === 'EXCLUSIVE'),
        source,
        status,
        canonical(definition),
        actor,
        data.expiresAt ?? null,
        data.teamId,
        data.repositoryId,
        data.repositoryId,
        data.issueNumber,
        definition.current_contract_hash,
        data.repositoryId,
        data.issueNumber,
        definition.capacity,
      ),
    db
      .prepare(
        'INSERT INTO audit(action,entity,actor,changes) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM issue_assignments WHERE id=?) THEN ? ELSE NULL END,?,?)',
      )
      .bind(
        'issue.assigned',
        id,
        id,
        actor,
        canonical({ before: null, after: data, source }),
      ),
  ];
  return { id, data, statements };
}
export async function assignIssue(
  env: Env,
  actor: string,
  raw: unknown,
  source: 'ORGANIZER' | 'CLAIM' | 'IMPORT' = 'ORGANIZER',
) {
  const prepared = await prepareAssignment(env, actor, raw, source);
  const results = await competitionDB(env).batch(prepared.statements);
  if (!results[2]?.meta.changes)
    throw new Error('ASSIGNMENT_NOT_AVAILABLE_OR_INELIGIBLE');
  await queueIssueLabels(
    env,
    prepared.data.repositoryId,
    prepared.data.issueNumber,
  );
  return { id: prepared.id };
}
export async function revokeAssignment(
  env: Env,
  actor: string,
  id: string,
  reason: string,
) {
  if (reason.trim().length < 10 || reason.length > 1000)
    throw new Error('REVOCATION_REASON_REQUIRED');
  const db = competitionDB(env),
    before = await db
      .prepare('SELECT * FROM issue_assignments WHERE id=?')
      .bind(id)
      .first<{ repository_id: number; issue_number: number }>();
  if (!before) throw new Error('ASSIGNMENT_NOT_FOUND');
  await db.batch([
    db
      .prepare(
        "UPDATE issue_assignments SET status='REVOKED',revoked_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(id),
    auditStatement(env, actor, 'issue.assignment.revoked', id, before, {
      reason,
    }),
  ]);
  await queueIssueLabels(env, before.repository_id, before.issue_number);
}
export async function activateReservation(env: Env, actor: string, id: string) {
  const db = competitionDB(env),
    reconciliationId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE issue_assignments AS a SET status='ACTIVE'
       WHERE a.id=? AND a.status='RESERVED'
         AND (a.expires_at IS NULL OR datetime(a.expires_at)>CURRENT_TIMESTAMP)
         AND json_valid(a.policy_snapshot)
         AND json_extract(a.policy_snapshot,'$.repository_id')=a.repository_id
         AND json_extract(a.policy_snapshot,'$.issue_number')=a.issue_number
         AND json_extract(a.policy_snapshot,'$.current_contract_hash')=a.contract_hash
         AND json_extract(a.policy_snapshot,'$.ownership') IN('EXCLUSIVE','SHARED')
         AND a.exclusive=CASE json_extract(a.policy_snapshot,'$.ownership') WHEN 'EXCLUSIVE' THEN 1 ELSE 0 END
         AND json_extract(a.policy_snapshot,'$.capacity') BETWEEN 1 AND 1000
         AND json_extract(a.policy_snapshot,'$.availability')='AVAILABLE'
         AND CASE WHEN json_valid(json_extract(a.policy_snapshot,'$.eligible_teams'))
                  THEN json_type(json_extract(a.policy_snapshot,'$.eligible_teams')) ELSE NULL END='array'
         AND (json_array_length(CASE WHEN json_valid(json_extract(a.policy_snapshot,'$.eligible_teams'))
                                    THEN json_extract(a.policy_snapshot,'$.eligible_teams') ELSE '[]' END)=0
              OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(json_extract(a.policy_snapshot,'$.eligible_teams'))
                                                     THEN json_extract(a.policy_snapshot,'$.eligible_teams') ELSE '[]' END) t WHERE t.value=a.team_id))
         AND EXISTS(SELECT 1 FROM contracts c WHERE c.hash=a.contract_hash AND c.repository_id=a.repository_id)
         AND EXISTS(SELECT 1 FROM challenge_versions v WHERE v.contract_hash=a.contract_hash AND v.repository_id=a.repository_id AND v.issue_number=a.issue_number)
         AND EXISTS(SELECT 1 FROM hackathons h WHERE h.id='initial' AND h.status='ACTIVE')
         AND EXISTS(SELECT 1 FROM teams t JOIN team_repositories tr ON tr.team_id=t.id JOIN github_repositories r ON r.id=tr.repository_id
                    WHERE t.id=a.team_id AND t.hackathon_id='initial' AND t.status='ACTIVE'
                      AND tr.repository_id=a.repository_id AND tr.active=1 AND r.accessible=1)
         AND EXISTS(SELECT 1 FROM github_issues i JOIN challenge_definitions d ON d.repository_id=i.repository_id AND d.issue_number=i.number
                    WHERE i.repository_id=a.repository_id AND i.number=a.issue_number AND i.official=1
                      AND i.review_status='APPROVED' AND i.github_state='open'
                      AND d.availability IN('AVAILABLE','RESERVED'))`,
      )
      .bind(id),
    db
      .prepare(
        `INSERT INTO github_sync_actions(id,repository_id,issue_number,kind,document)
       SELECT ?,a.repository_id,a.issue_number,'LABELS','{"labels":[]}'
       FROM issue_assignments a WHERE a.id=? AND a.status='ACTIVE' AND changes()=1`,
      )
      .bind(reconciliationId, id),
    db
      .prepare(
        `INSERT INTO audit(action,entity,actor,changes)
       SELECT 'assignment.reservation.activated',a.id,?,json_object(
         'before',json_object('status','RESERVED'),
         'after',json_object('status','ACTIVE','contractHash',a.contract_hash,
                             'policySnapshot',json(a.policy_snapshot),'expiresAt',a.expires_at))
       FROM issue_assignments a WHERE a.id=? AND a.status='ACTIVE' AND changes()=1`,
      )
      .bind(actor, id),
  ]);
  if (!results[0]?.meta.changes)
    throw new Error('RESERVATION_ACTIVATION_CONFLICT');
  const assignment = await db
    .prepare(
      "SELECT repository_id,issue_number FROM issue_assignments WHERE id=? AND status='ACTIVE'",
    )
    .bind(id)
    .first<{ repository_id: number; issue_number: number }>();
  if (!assignment) throw new Error('RESERVATION_ACTIVATION_CONFLICT');
  try {
    await queueIssueLabels(
      env,
      assignment.repository_id,
      assignment.issue_number,
    );
  } catch {
    // The transaction already stored a durable label reconciliation intent.
  }
}
export async function queueIssueLabels(
  env: Env,
  repositoryId: number,
  number: number,
) {
  const db = competitionDB(env),
    settings = await eventSettings(env),
    issue = await db
      .prepare(
        'SELECT source,classification,overrides,review_status,official FROM github_issues WHERE repository_id=? AND number=?',
      )
      .bind(repositoryId, number)
      .first<{
        source: string;
        classification: string;
        overrides: string;
        review_status: string;
        official: number;
      }>();
  if (!issue) return;
  const classification = JSON.parse(issue.classification),
    overrides = JSON.parse(issue.overrides),
    definition = await db
      .prepare(
        'SELECT evaluation_kind,availability FROM challenge_definitions WHERE repository_id=? AND issue_number=?',
      )
      .bind(repositoryId, number)
      .first<{ evaluation_kind: string; availability: string }>();
  const assignments = await db
    .prepare(
      "SELECT progress FROM issue_assignments WHERE repository_id=? AND issue_number=? AND status='ACTIVE'",
    )
    .bind(repositoryId, number)
    .all<{ progress: string }>();
  let status = issue.review_status.toLowerCase().replaceAll('_', '-');
  if (issue.official && issue.review_status === 'APPROVED') {
    status = assignments.results.length
      ? assignments.results.every((a) => a.progress === 'COMPLETED')
        ? 'completed'
        : assignments.results.some((a) => a.progress === 'EVALUATING')
          ? 'needs-review'
          : assignments.results.some((a) => a.progress === 'IN_PROGRESS')
            ? 'in-progress'
            : 'assigned'
      : definition?.availability === 'AVAILABLE'
        ? 'available'
        : 'blocked';
  }
  const desired = [
    'judge:source:' + issue.source.toLowerCase(),
    'judge:status:' + status,
    'judge:evaluation:' +
      (issue.official && issue.review_status === 'APPROVED'
        ? definition?.evaluation_kind.toLowerCase().replaceAll('_', '-')
        : 'not-scored'),
    ...(issue.official && issue.review_status === 'APPROVED'
      ? ['judge:evaluation:approved-challenge']
      : []),
    ...(classification.type ? ['judge:type:' + classification.type] : []),
    ...(classification.priority
      ? ['judge:priority:' + classification.priority]
      : []),
    ...(classification.difficulty
      ? ['judge:difficulty:' + classification.difficulty]
      : []),
    ...(classification.domains ?? []).map(
      (domain: string) => 'judge:domain:' + domain,
    ),
    ...classification.flags
      .filter((f: string) =>
        [
          'needs-information',
          'possible-duplicate',
          'security-review',
          'possible-spam',
        ].includes(f),
      )
      .map((f: string) => 'judge:status:' + f),
  ];
  const labels = desired.filter(
    (name) =>
      settings.taxonomy.some((l) => l.name === name) &&
      !(overrides.suppressedLabels ?? []).includes(name),
  );
  const document = canonical({ labels }),
    id = await digest(canonical({ repositoryId, number, document }));
  await db
    .prepare(
      "INSERT INTO github_sync_actions(id,repository_id,issue_number,kind,document) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=CASE WHEN github_sync_actions.status='COMPLETED' THEN 'PENDING' ELSE github_sync_actions.status END",
    )
    .bind(id, repositoryId, number, 'LABELS', document)
    .run();
  return id;
}
