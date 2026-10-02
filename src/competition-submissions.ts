import { z } from 'zod';
import { canonical, digest, sha } from './domain';
import { redact } from './security';
import { linkedIssueNumbers } from './competition-domain';
import {
  competitionDB,
  combinedContract,
  eventSettings,
  registerNeutralRepository,
  auditStatement,
  type CompetitionServices,
} from './competition-store';
import { acceptPullRequest } from './intake';
import type { Env } from './env';
const nativePR = z.object({
  number: z.number().int().positive(),
  title: z.string().max(1000),
  body: z.string().max(50000).nullable(),
  user: z.object({
    id: z.number().int().positive(),
    login: z.string().max(100),
  }),
  head: z.object({ sha }),
  base: z.object({ sha, repo: z.object({ id: z.number().int().positive() }) }),
  state: z.enum(['open', 'closed']),
  draft: z.boolean().default(false),
  updated_at: z.string().datetime(),
});
export const resolutionSchema = z
  .object({
    teamId: z.string().max(80),
    assignmentIds: z.array(z.string().max(80)).min(1).max(30),
    reason: z.string().trim().min(20).max(1000),
    relationship: z
      .enum(['PRIMARY', 'ALTERNATE', 'RELATED', 'STACKED', 'SUPERSEDES'])
      .default('PRIMARY'),
    relatedPR: z.number().int().positive().optional(),
  })
  .strict();
export async function githubLinkedIssues(
  client: Awaited<ReturnType<CompetitionServices['client']>>,
  fullName: string,
  prNumber: number,
) {
  const [owner, name] = fullName.split('/');
  const result = await client.api<{
    errors?: unknown;
    data?: {
      repository?: {
        pullRequest?: {
          closingIssuesReferences: {
            nodes: { number: number; repository: { nameWithOwner: string } }[];
            pageInfo: { hasNextPage: boolean };
          };
        };
      };
    };
  }>('/graphql', {
    method: 'POST',
    body: canonical({
      query:
        'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:50){nodes{number repository{nameWithOwner}} pageInfo{hasNextPage}}}}}',
      variables: { owner, name, number: prNumber },
    }),
  });
  const links = result.data?.repository?.pullRequest?.closingIssuesReferences;
  if (
    result.errors ||
    !links ||
    links.pageInfo.hasNextPage ||
    links.nodes.length > 50
  )
    throw new Error('GITHUB_ISSUE_LINKS_UNAVAILABLE');
  return links.nodes;
}
export async function resolveSubmission(
  env: Env,
  services: CompetitionServices,
  ctx: ExecutionContext,
  repositoryId: number,
  prNumber: number,
  delivery: string,
  payloadHash: string,
  actor = 'system',
  manual?: z.infer<typeof resolutionSchema>,
) {
  const db = competitionDB(env),
    repo = await registerNeutralRepository(env, services, repositoryId),
    settings = await eventSettings(env),
    client = await services.client(repositoryId);
  const pr = nativePR.parse(
    await client.api(`/repos/${repo.full_name}/pulls/${prNumber}`),
  );
  if (pr.number !== prNumber || pr.base.repo.id !== repo.id)
    throw new Error('PR_REPOSITORY_MISMATCH');
  const before = await db
    .prepare('SELECT * FROM submissions WHERE repository_id=? AND pr_number=?')
    .bind(repo.id, pr.number)
    .first<{
      resolution_revision: number;
      override: string | null;
      github_updated_at: string;
      head_sha: string;
      team_id: string | null;
    }>();
  if (before && before.github_updated_at > pr.updated_at)
    return { status: 'STALE' };
  const parsedLinks = linkedIssueNumbers(pr.body ?? '', repo.full_name),
    nativeLinks = await githubLinkedIssues(client, repo.full_name, pr.number);
  const issueNumbers = [
    ...new Set([
      ...parsedLinks.local,
      ...nativeLinks
        .filter(
          (n) =>
            n.repository.nameWithOwner.toLowerCase() ===
            repo.full_name.toLowerCase(),
        )
        .map((n) => n.number),
    ]),
  ].sort((a, b) => a - b);
  const foreign = [
    ...parsedLinks.foreign,
    ...nativeLinks
      .filter(
        (n) =>
          n.repository.nameWithOwner.toLowerCase() !==
          repo.full_name.toLowerCase(),
      )
      .map((n) => n.repository.nameWithOwner + '#' + n.number),
  ];
  const linkHash = await digest(canonical({ issueNumbers, foreign }));
  const saved = before?.override ? JSON.parse(before.override) : null;
  const override = manual
    ? {
        ...resolutionSchema.parse(manual),
        actor,
        authorId: pr.user.id,
        linkHash,
      }
    : saved?.authorId === pr.user.id && saved?.linkHash === linkHash
      ? saved
      : null;
  if (manual && !settings.policy.organizerMappingOverrideAllowed)
    throw new Error('ORGANIZER_MAPPING_OVERRIDE_DISABLED');
  const member = await db
    .prepare(
      "SELECT t.id,t.name,t.status FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.github_id=? AND m.active=1 AND m.hackathon_id='initial'",
    )
    .bind(pr.user.id)
    .first<{ id: string; name: string; status: string }>();
  const teamId = override?.teamId ?? member?.id ?? null;
  const team = teamId
    ? await db
        .prepare('SELECT id,name,status FROM teams WHERE id=?')
        .bind(teamId)
        .first<{ id: string; name: string; status: string }>()
    : null;
  let status = 'VALID',
    reason =
      'Structured membership, repository eligibility and issue assignments match.',
    assigned: {
      id: string;
      issue_number: number;
      contract_hash: string;
      progress: string;
    }[] = [];
  if (!team) {
    status = 'NEEDS_TEAM_MAPPING';
    reason =
      'GitHub numeric author identity has no unambiguous registered team.';
  } else if (team.status !== 'ACTIVE') {
    status = 'INELIGIBLE_TEAM';
    reason = 'Team is not active; status ' + team.status + '.';
  } else if (
    !(await db
      .prepare(
        'SELECT team_id FROM team_repositories WHERE team_id=? AND repository_id=? AND active=1',
      )
      .bind(team.id, repo.id)
      .first())
  ) {
    status = 'WRONG_REPOSITORY';
    reason = 'Team is not assigned this repository.';
  } else {
    const rows = await db
      .prepare(
        "SELECT id,issue_number,contract_hash,progress FROM issue_assignments WHERE team_id=? AND repository_id=? AND status='ACTIVE' AND (expires_at IS NULL OR datetime(expires_at)>CURRENT_TIMESTAMP)",
      )
      .bind(team.id, repo.id)
      .all<{
        id: string;
        issue_number: number;
        contract_hash: string;
        progress: string;
      }>();
    assigned = override
      ? rows.results.filter((a) => override.assignmentIds.includes(a.id))
      : rows.results.filter((a) => issueNumbers.includes(a.issue_number));
    if (override && assigned.length !== override.assignmentIds.length) {
      status = 'ASSIGNMENT_REVOKED';
      reason =
        'Organizer mapping refers to an inactive, expired or missing assignment.';
    } else if (!assigned.length) {
      status = 'NEEDS_ISSUE_MAPPING';
      reason = 'No active assigned issue is linked to this PR.';
    } else if (
      !override &&
      (foreign.length ||
        issueNumbers.some((n) => !assigned.some((a) => a.issue_number === n)))
    ) {
      status = 'ISSUE_LINK_CONFLICT';
      reason =
        'Native or closing-keyword links include issues outside the team assignment.';
    } else if (assigned.some((a) => a.progress === 'BLOCKED')) {
      status = 'BLOCKED_ASSIGNMENT';
      reason = 'An assigned challenge is blocked.';
    } else if (assigned.length > 1 && !settings.policy.multipleIssuesPerPR) {
      status = 'MULTIPLE_ISSUES_NOT_ALLOWED';
      reason = 'Event policy permits one assigned issue per PR.';
    } else if (!settings.policy.multiplePRsPerIssue) {
      const others = await db
        .prepare(
          "SELECT pr_number,assignment_ids FROM submissions WHERE repository_id=? AND pr_number<>? AND team_id=? AND status='VALID'",
        )
        .bind(repo.id, pr.number, team.id)
        .all<{ pr_number: number; assignment_ids: string }>();
      if (
        others.results.some((s) =>
          JSON.parse(s.assignment_ids).some((id: string) =>
            assigned.some((a) => a.id === id),
          ),
        )
      ) {
        status = 'MULTIPLE_PRS_NOT_ALLOWED';
        reason =
          'Another PR already submits this assignment under the event policy.';
      }
    }
  }
  if (pr.draft && !settings.policy.allowDraftSubmissions) {
    status = 'DRAFT';
    reason =
      'Draft PRs are recorded but evaluation waits for ready-for-review.';
  }
  if (pr.state === 'closed') {
    status = 'CLOSED';
    reason =
      'GitHub PR is closed; this does not establish successful completion.';
  }
  const snapshot = redact(
    canonical({
      ...pr,
      linkedIssues: issueNumbers,
      foreignLinks: foreign,
      relationship: override?.relationship ?? 'PRIMARY',
      relatedPR: override?.relatedPR ?? null,
    }),
  );
  let registered: Awaited<ReturnType<typeof combinedContract>> | null = null;
  if (status === 'VALID')
    try {
      registered = await combinedContract(env, assigned);
    } catch (error) {
      status = 'INCOMPATIBLE_ISSUE_CONTRACTS';
      reason =
        error instanceof Error
          ? error.message
          : 'Assigned contract contexts cannot be combined.';
    }
  const updates = [
    db
      .prepare(
        "INSERT INTO audit(action,entity,actor) VALUES('submission.fence',CASE WHEN NOT EXISTS(SELECT 1 FROM submissions WHERE repository_id=? AND pr_number=? AND resolution_revision<>?) AND NOT EXISTS(SELECT 1 FROM submissions WHERE repository_id=? AND pr_number=? AND (github_updated_at>? OR (github_updated_at=? AND head_sha<>?))) AND (?=1 OR ?<>'VALID' OR NOT EXISTS(SELECT 1 FROM submissions s JOIN json_each(s.assignment_ids) j WHERE s.repository_id=? AND s.pr_number<>? AND s.status='VALID' AND j.value IN (SELECT value FROM json_each(?)))) THEN ? ELSE NULL END,?)",
      )
      .bind(
        repo.id,
        pr.number,
        before?.resolution_revision ?? 0,
        repo.id,
        pr.number,
        pr.updated_at,
        pr.updated_at,
        pr.head.sha,
        Number(settings.policy.multiplePRsPerIssue),
        status,
        repo.id,
        pr.number,
        canonical(assigned.map((a) => a.id)),
        repo.id + ':' + pr.number,
        actor,
      ),
    db
      .prepare(
        "INSERT INTO submissions(repository_id,pr_number,id,head_sha,latest_run_id,github_updated_at,closed,team_id,author_id,author_login,base_sha,issue_numbers,assignment_ids,status,mapping_reason,override,pr_snapshot,resolution_revision) VALUES(?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(repository_id,pr_number) DO UPDATE SET resolution_revision=excluded.resolution_revision,head_sha=excluded.head_sha,github_updated_at=excluded.github_updated_at,closed=excluded.closed,team_id=excluded.team_id,author_id=excluded.author_id,author_login=excluded.author_login,base_sha=excluded.base_sha,issue_numbers=excluded.issue_numbers,assignment_ids=excluded.assignment_ids,status=excluded.status,mapping_reason=excluded.mapping_reason,override=excluded.override,pr_snapshot=excluded.pr_snapshot,latest_run_id=CASE WHEN excluded.status='VALID' OR (excluded.status='CLOSED' AND excluded.head_sha=submissions.head_sha) THEN submissions.latest_run_id ELSE NULL END WHERE excluded.github_updated_at>=submissions.github_updated_at",
      )
      .bind(
        repo.id,
        pr.number,
        repo.id + ':' + pr.number,
        pr.head.sha,
        pr.updated_at,
        Number(pr.state === 'closed'),
        team?.id ?? null,
        pr.user.id,
        pr.user.login,
        pr.base.sha,
        canonical(assigned.map((a) => a.issue_number)),
        canonical(assigned.map((a) => a.id)),
        status,
        reason,
        override ? canonical(override) : null,
        snapshot,
        (before?.resolution_revision ?? 0) + 1,
      ),
    auditStatement(
      env,
      actor,
      manual ? 'submission.mapping.overridden' : 'submission.synchronized',
      repo.id + ':' + pr.number,
      before,
      {
        status,
        reason,
        teamId: team?.id ?? null,
        issueNumbers: assigned.map((a) => a.issue_number),
        override,
      },
    ),
  ];
  if (status !== 'VALID')
    updates.push(
      db
        .prepare(
          "UPDATE evaluations SET state='SUPERSEDED',updated_at=CURRENT_TIMESTAMP WHERE repository_id=? AND pr_number=? AND state NOT IN('COMPLETED','FAILED','SUPERSEDED')",
        )
        .bind(repo.id, pr.number),
    );
  if (registered && team) {
    const resolution = {
      resolutionRevision: (before?.resolution_revision ?? 0) + 1,
      assignmentIds: assigned.map((a) => a.id),
      githubAuthor: pr.user,
      pr: JSON.parse(snapshot),
      override,
    };
    updates.push(
      db
        .prepare(
          'INSERT INTO assignments(repository_id,pr_number,team_id,issue_numbers,contract_hash,resolution_snapshot) VALUES(?,?,?,?,?,?) ON CONFLICT(repository_id,pr_number) DO UPDATE SET team_id=excluded.team_id,issue_numbers=excluded.issue_numbers,contract_hash=excluded.contract_hash,resolution_snapshot=excluded.resolution_snapshot',
        )
        .bind(
          repo.id,
          pr.number,
          team.id,
          canonical(assigned.map((a) => a.issue_number)),
          registered.hash,
          canonical(resolution),
        ),
    );
    for (const assignment of assigned)
      updates.push(
        db
          .prepare(
            "UPDATE issue_assignments SET progress=CASE WHEN progress='COMPLETED' THEN progress ELSE 'EVALUATING' END WHERE id=? AND status='ACTIVE'",
          )
          .bind(assignment.id),
      );
  }
  await db.batch(updates);
  if (!registered) return { status, reason };
  const orgenv = await services.evaluationEnv();
  const result = await acceptPullRequest(
    {
      action: 'synchronize',
      installation: { id: await services.installationId() },
      repository: { id: repo.id, full_name: repo.full_name },
      pull_request: pr,
    },
    orgenv,
    ctx,
    delivery,
    payloadHash,
  );
  return { status, reason, evaluation: await result.json() };
}
