import { z } from 'zod';
import { canonical, digest } from './domain';
import { competitionDB } from './competition-store';
import { redact } from './security';
import type { Env } from './env';

export const submissionRelationSchema = z
  .object({
    repositoryId: z.number().int().positive(),
    sourcePr: z.number().int().positive(),
    targetPr: z.number().int().positive(),
    kind: z.enum(['ALTERNATE', 'DUPLICATE', 'SUPERSEDES', 'DEPENDS_ON']),
    reason: z.string().trim().min(20).max(2000),
    requestId: z.string().uuid(),
  })
  .strict();
type RelationRow = {
  id: string;
  repository_id: number;
  source_pr: number;
  target_pr: number;
  kind: 'ALTERNATE' | 'DUPLICATE' | 'SUPERSEDES' | 'DEPENDS_ON';
  source_head_sha: string | null;
  target_head_sha: string | null;
  reason: string;
  actor: string;
  request_id: string;
  request_hash: string;
  team_id: string;
  issue_numbers: string;
  created_at: string;
};
function output(row: RelationRow) {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    sourcePr: row.source_pr,
    targetPr: row.target_pr,
    kind: row.kind,
    sourceHead: row.source_head_sha,
    targetHead: row.target_head_sha,
    evaluationPolicy:
      row.kind === 'DEPENDS_ON'
        ? 'INDEPENDENT_FROZEN_BASELINE_NO_DEPENDENCY_CREDIT'
        : 'INDEPENDENT_ATTEMPTS',
    reason: row.reason,
    actor: row.actor,
    requestId: row.request_id,
    teamId: row.team_id,
    issueNumbers: JSON.parse(row.issue_numbers) as number[],
    createdAt: row.created_at,
  };
}

// Immutable organizer labels never alter submission, execution, or scoring state.
export async function createSubmissionRelation(
  env: Env,
  actor: string,
  raw: unknown,
): Promise<{ status: number; body: unknown }> {
  const parsed = submissionRelationSchema.safeParse(raw);
  if (!parsed.success || !actor.trim() || actor.length > 160)
    return { status: 400, body: { error: 'Invalid submission relation' } };
  const input = parsed.data,
    reason = redact(input.reason).trim();
  if (
    input.sourcePr === input.targetPr ||
    reason.length < 20 ||
    reason.length > 2000
  )
    return {
      status: 400,
      body: { error: 'Invalid submission relation endpoints or reason' },
    };
  const requestHash = await digest(canonical({ ...input, actor }));
  const db = competitionDB(env);
  const results = await db.batch([
    db
      .prepare(
        `WITH RECURSIVE reachable(pr) AS (
 SELECT ? UNION SELECT r.target_pr FROM submission_relations r JOIN reachable p ON r.source_pr=p.pr
 WHERE r.repository_id=? AND r.kind=?
)
INSERT OR IGNORE INTO submission_relations
 (id,repository_id,source_pr,target_pr,kind,reason,actor,request_id,request_hash,team_id,source_head_sha,target_head_sha,issue_numbers)
SELECT ?,s.repository_id,s.pr_number,t.pr_number,?,?,?,?,?,s.team_id,s.head_sha,t.head_sha,
 (SELECT json_group_array(issue) FROM (
  SELECT DISTINCT a.value AS issue FROM json_each(s.issue_numbers) a
  JOIN json_each(t.issue_numbers) b ON b.value=a.value
  WHERE a.type='integer' AND b.type='integer' AND a.value>0 ORDER BY a.value))
FROM submissions s JOIN submissions t ON t.repository_id=s.repository_id
WHERE s.repository_id=? AND s.pr_number=? AND t.pr_number=?
 AND s.status IN('VALID','CLOSED') AND t.status IN('VALID','CLOSED')
 AND s.team_id IS NOT NULL AND length(s.team_id)>0 AND s.team_id=t.team_id
 AND EXISTS(SELECT 1 FROM json_each(s.issue_numbers) a JOIN json_each(t.issue_numbers) b ON b.value=a.value
  WHERE a.type='integer' AND b.type='integer' AND a.value>0)
 AND (SELECT count(*) FROM submission_relations r WHERE r.repository_id=s.repository_id
  AND (r.source_pr=s.pr_number OR r.target_pr=s.pr_number))<20
 AND (SELECT count(*) FROM submission_relations r WHERE r.repository_id=t.repository_id
  AND (r.source_pr=t.pr_number OR r.target_pr=t.pr_number))<20
 AND (? NOT IN('SUPERSEDES','DEPENDS_ON') OR NOT EXISTS(SELECT 1 FROM reachable WHERE pr=?))
 AND NOT EXISTS(SELECT 1 FROM submission_relations WHERE request_id=?)`,
      )
      .bind(
        input.targetPr,
        input.repositoryId,
        input.kind,
        crypto.randomUUID(),
        input.kind,
        reason,
        actor,
        input.requestId,
        requestHash,
        input.repositoryId,
        input.sourcePr,
        input.targetPr,
        input.kind,
        input.sourcePr,
        input.requestId,
      ),
    db
      .prepare(
        "INSERT INTO audit(action,entity,actor,changes) SELECT 'submission.relation.created',?,?,? WHERE changes()=1",
      )
      .bind(
        input.repositoryId + ':' + input.sourcePr,
        actor,
        canonical({ ...input, reason, requestHash }),
      ),
  ]);
  const row = await db
    .prepare('SELECT * FROM submission_relations WHERE request_id=?')
    .bind(input.requestId)
    .first<RelationRow>();
  if (row && row.request_hash === requestHash)
    return {
      status: results[0]?.meta.changes === 1 ? 201 : 200,
      body: output(row),
    };
  return {
    status: 409,
    body: {
      error: row
        ? 'Idempotency key reused'
        : 'Relation requires mapped same-team submissions sharing an issue, capacity, and no supersession cycle',
    },
  };
}

export async function listSubmissionRelations(
  db: D1Database,
  repo: number,
  pr: number,
) {
  const rows = await db
    .prepare(
      'SELECT * FROM submission_relations WHERE repository_id=? AND (source_pr=? OR target_pr=?) ORDER BY created_at,id',
    )
    .bind(repo, pr, pr)
    .all<RelationRow>();
  return rows.results.map(output);
}
