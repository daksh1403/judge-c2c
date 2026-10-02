import { z } from 'zod';
import {
  canonical,
  contractSchema,
  type Evidence,
  type Review,
} from './domain';
import {
  competitionDB,
  eventSettings,
  auditStatement,
} from './competition-store';
import { queueIssueLabels } from './competition-issues';
import type { Env } from './env';
export function completionEligibility(
  contract: unknown,
  report: unknown,
  evidence: Evidence[],
  issueNumber: number,
) {
  const c = contractSchema.parse(contract),
    review = report as Review | undefined;
  const prefix = c.issueNumbers.length > 1 ? 'i' + issueNumber + '-' : '';
  const required = c.requirements
    .filter((r) => r.mandatory && (!prefix || r.id.startsWith(prefix)))
    .flatMap((r) => r.criteria.map((a) => a.id));
  const missing = required.filter(
    (id) =>
      review?.assessments?.find((a) => a.criterionId === id)?.status !==
        'PASS' ||
      !evidence.some(
        (e) =>
          e.criterionId === id &&
          e.status === 'PASS' &&
          (c.requirements.flatMap((r) => r.criteria).find((a) => a.id === id)
            ?.kind !== 'functional' ||
            e.kind === 'execution'),
      ),
  );
  const regression = evidence.some(
    (e) =>
      e.status === 'FAIL' &&
      (e.baselineStatus === 'PASS' || e.kind === 'policy'),
  );
  return {
    eligible: required.length > 0 && !missing.length && !regression,
    mandatoryCriteria: required,
    unverifiedOrFailed: missing,
    regressionOrPolicyFailure: regression,
  };
}
export async function decideCompletion(
  env: Env,
  actor: string,
  assignmentId: string,
  raw: unknown,
) {
  const data = z
      .object({
        runId: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        decision: z.enum(['ACCEPTED', 'CHANGES_REQUESTED', 'REOPENED']),
        reason: z.string().trim().min(20).max(2000),
        override: z.boolean().default(false),
      })
      .strict()
      .parse(raw),
    db = competitionDB(env),
    settings = await eventSettings(env);
  const assignment = await db
    .prepare(
      "SELECT * FROM issue_assignments WHERE id=? AND status='ACTIVE' AND (expires_at IS NULL OR datetime(expires_at)>CURRENT_TIMESTAMP)",
    )
    .bind(assignmentId)
    .first<{ team_id: string; repository_id: number; issue_number: number }>();
  if (!assignment) throw new Error('ACTIVE_ASSIGNMENT_REQUIRED');
  const run = data.runId
    ? await db
        .prepare(
          'SELECT e.*,s.head_sha AS current_head,s.latest_run_id,s.team_id,s.assignment_ids FROM evaluations e JOIN submissions s ON s.repository_id=e.repository_id AND s.pr_number=e.pr_number WHERE e.id=?',
        )
        .bind(data.runId)
        .first<{
          id: string;
          state: string;
          head_sha: string;
          current_head: string;
          latest_run_id: string;
          team_id: string;
          assignment_ids: string;
          assignment_snapshot: string;
          contract_snapshot: string;
          report: string | null;
          evidence: string | null;
        }>()
    : null;
  const frozen = run ? JSON.parse(run.assignment_snapshot) : null;
  const frozenResolution = frozen?.resolution_snapshot
    ? JSON.parse(frozen.resolution_snapshot)
    : null;
  if (
    data.runId &&
    (!run ||
      run.team_id !== assignment.team_id ||
      !JSON.parse(run.assignment_ids).includes(assignmentId) ||
      frozen?.team_id !== assignment.team_id ||
      !frozenResolution?.assignmentIds?.includes(assignmentId))
  )
    throw new Error('EVALUATION_ASSIGNMENT_MISMATCH');
  const eligibility = run
    ? completionEligibility(
        JSON.parse(run.contract_snapshot),
        run.report ? JSON.parse(run.report) : undefined,
        JSON.parse(run.evidence ?? '[]'),
        assignment.issue_number,
      )
    : {
        eligible: false,
        mandatoryCriteria: [],
        unverifiedOrFailed: ['NO_CURRENT_EVALUATION'],
        regressionOrPolicyFailure: false,
      };
  if (data.decision === 'ACCEPTED') {
    if (
      !run ||
      run.state !== 'COMPLETED' ||
      run.latest_run_id !== run.id ||
      run.current_head !== run.head_sha
    )
      throw new Error('CURRENT_COMPLETED_EVALUATION_REQUIRED');
    if (
      !eligibility.eligible &&
      !(data.override && settings.policy.completionOverrideAllowed)
    )
      throw new Error('REQUIREMENTS_NOT_VERIFIED');
  }
  const id = 'decision-' + crypto.randomUUID(),
    progress =
      data.decision === 'ACCEPTED'
        ? 'COMPLETED'
        : data.decision === 'REOPENED'
          ? 'IN_PROGRESS'
          : 'NEEDS_REVIEW';
  await db.batch([
    db
      .prepare(
        "INSERT INTO audit(action,entity,actor) VALUES('completion.fence',CASE WHEN EXISTS(SELECT 1 FROM issue_assignments a JOIN teams t ON t.id=a.team_id JOIN team_repositories tr ON tr.team_id=t.id AND tr.repository_id=a.repository_id WHERE a.id=? AND a.status='ACTIVE' AND (a.expires_at IS NULL OR datetime(a.expires_at)>CURRENT_TIMESTAMP) AND t.status='ACTIVE' AND tr.active=1) AND (?<>'ACCEPTED' OR EXISTS(SELECT 1 FROM evaluations e JOIN submissions s ON s.latest_run_id=e.id WHERE e.id=? AND e.state='COMPLETED' AND e.head_sha=s.head_sha AND s.team_id=? AND json_extract(e.assignment_snapshot,'$.team_id')=s.team_id AND EXISTS(SELECT 1 FROM json_each(json_extract(json_extract(e.assignment_snapshot,'$.resolution_snapshot'),'$.assignmentIds')) WHERE value=?) AND EXISTS(SELECT 1 FROM json_each(s.assignment_ids) WHERE value=?))) THEN ? ELSE NULL END,?)",
      )
      .bind(
        assignmentId,
        data.decision,
        run?.id ?? null,
        assignment.team_id,
        assignmentId,
        assignmentId,
        id,
        actor,
      ),
    db
      .prepare(
        'INSERT INTO completion_decisions(id,assignment_id,run_id,decision,reason,actor,evidence_snapshot) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(
        id,
        assignmentId,
        run?.id ?? null,
        data.decision,
        data.reason,
        actor,
        canonical({
          eligibility,
          override: data.override,
          report: run?.report ? JSON.parse(run.report) : null,
          evidence: JSON.parse(run?.evidence ?? '[]'),
        }),
      ),
    db
      .prepare(
        "UPDATE issue_assignments SET progress=? WHERE id=? AND status='ACTIVE'",
      )
      .bind(progress, assignmentId),
    auditStatement(env, actor, 'issue.completion.decided', assignmentId, null, {
      id,
      ...data,
      eligibility,
    }),
  ]);
  await queueIssueLabels(
    env,
    assignment.repository_id,
    assignment.issue_number,
  );
  return { id, eligibility, progress };
}
export async function updateAssignmentProgress(env: Env, runId: string) {
  if (!env.ORG_DB) return;
  const db = competitionDB(env),
    run = await db
      .prepare(
        'SELECT e.state,e.assignment_snapshot,s.latest_run_id FROM evaluations e JOIN submissions s ON s.repository_id=e.repository_id AND s.pr_number=e.pr_number WHERE e.id=?',
      )
      .bind(runId)
      .first<{
        state: string;
        assignment_snapshot: string;
        latest_run_id: string;
      }>();
  if (!run || run.latest_run_id !== runId) return;
  const snapshot = JSON.parse(run.assignment_snapshot),
    resolution = snapshot.resolution_snapshot
      ? JSON.parse(snapshot.resolution_snapshot)
      : null;
  if (!resolution) return;
  for (const id of resolution.assignmentIds as string[]) {
    const assignment = await db
      .prepare(
        "SELECT repository_id,issue_number FROM issue_assignments WHERE id=? AND status='ACTIVE'",
      )
      .bind(id)
      .first<{ repository_id: number; issue_number: number }>();
    if (!assignment) continue;
    const accepted = await db
      .prepare(
        'SELECT d.decision,e.head_sha,s.head_sha AS current_head,s.latest_run_id,d.run_id FROM completion_decisions d LEFT JOIN evaluations e ON e.id=d.run_id LEFT JOIN submissions s ON s.repository_id=e.repository_id AND s.pr_number=e.pr_number WHERE d.assignment_id=? ORDER BY d.sequence DESC LIMIT 1',
      )
      .bind(id)
      .first<{
        decision: string;
        head_sha: string;
        current_head: string;
        latest_run_id: string;
        run_id: string;
      }>();
    const completed =
      accepted?.decision === 'ACCEPTED' &&
      accepted.head_sha === accepted.current_head &&
      accepted.run_id === accepted.latest_run_id;
    const progress = completed
      ? 'COMPLETED'
      : ['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(run.state)
        ? 'NEEDS_REVIEW'
        : 'EVALUATING';
    await db
      .prepare(
        "UPDATE issue_assignments SET progress=? WHERE id=? AND status='ACTIVE'",
      )
      .bind(progress, id)
      .run();
    await queueIssueLabels(
      env,
      assignment.repository_id,
      assignment.issue_number,
    );
  }
}
