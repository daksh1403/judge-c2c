import { organizationActive } from './organization-retirement';
import { canTransition, type State, type Contract } from './domain';
import type { Env } from './env';
export interface Run {
  id: string;
  repository_id: number;
  pr_number: number;
  head_sha: string;
  baseline_sha: string;
  contract_hash: string;
  contract_snapshot: string;
  assignment_snapshot: string;
  state: State;
  evidence: string | null;
  report: string | null;
  context: string | null;
  ai_status: string | null;
  failure_code: string | null;
  check_run_id: number | null;
  publication_status: string;
  created_at: string;
}
export async function getRun(env: Env, id: string) {
  return env.DB.prepare('SELECT * FROM evaluations WHERE id=?')
    .bind(id)
    .first<Run>();
}
export async function transition(
  env: Env,
  id: string,
  from: State,
  to: State,
  detail = '',
) {
  if (!canTransition(from, to)) throw new Error('Invalid state transition');
  const results = await env.DB.batch([
    env.DB.prepare(
      'UPDATE evaluations SET state=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state=?',
    ).bind(to, id, from),
    env.DB.prepare(
      'INSERT OR IGNORE INTO timeline(run_id,state,detail) SELECT id,state,? FROM evaluations WHERE id=? AND state=?',
    ).bind(detail, id, to),
  ]);
  return results[0]!.meta.changes > 0;
}
export async function isCurrent(env: Env, run: Run) {
  if (!(await organizationActive(env))) return false;
  const s = await env.DB.prepare(
    'SELECT latest_run_id,closed FROM submissions WHERE repository_id=? AND pr_number=?',
  )
    .bind(run.repository_id, run.pr_number)
    .first<{ latest_run_id: string; closed: number }>();
  if (s?.latest_run_id !== run.id || s.closed || run.state === 'SUPERSEDED')
    return false;
  const snapshot = JSON.parse(run.assignment_snapshot);
  const resolution = snapshot.resolution_snapshot
    ? JSON.parse(snapshot.resolution_snapshot)
    : null;
  if (!resolution) return true; // Explicit legacy organizer mapping remains historical.
  const eligible = await env.DB.prepare(
    "SELECT t.id FROM teams t JOIN team_repositories r ON r.team_id=t.id WHERE t.id=? AND t.status='ACTIVE' AND r.repository_id=? AND r.active=1 AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN issue_assignments a ON a.id=j.value LEFT JOIN github_issues i ON i.repository_id=a.repository_id AND i.number=a.issue_number WHERE a.id IS NULL OR a.status<>'ACTIVE' OR i.review_status IS NULL OR i.review_status<>'APPROVED' OR (a.expires_at IS NOT NULL AND datetime(a.expires_at)<=CURRENT_TIMESTAMP)) AND (?=1 OR EXISTS(SELECT 1 FROM team_members WHERE team_id=t.id AND github_id=? AND active=1))",
  )
    .bind(
      snapshot.team_id,
      run.repository_id,
      JSON.stringify(resolution.assignmentIds),
      Number(!!resolution.override),
      resolution.githubAuthor.id,
    )
    .first();
  return !!eligible;
}
export async function dispatch(env: Env, runId: string) {
  if (!(await organizationActive(env))) return;
  const run = await getRun(env, runId);
  if (!run || run.state !== 'QUEUED') return;
  // Status outages cannot prevent asynchronous evaluation dispatch.
  await (await import('./github-checks')).publish(env, run).catch(() => {});
  if (!(await organizationActive(env))) return;
  try {
    await env.EVALUATOR.create({ id: runId, params: { runId } });
  } catch {
    // Creation is idempotent by workflow ID. Only acknowledge after confirming existence.
    const instance = await env.EVALUATOR.get(runId);
    await instance.status();
  }
  await env.DB.prepare(
    'UPDATE outbox SET dispatched_at=CURRENT_TIMESTAMP,attempts=attempts+1 WHERE run_id=?',
  )
    .bind(runId)
    .run();
}
export async function reconcile(env: Env) {
  if (!(await organizationActive(env))) return;
  const rows = await env.DB.prepare(
    "SELECT o.run_id FROM outbox o JOIN evaluations e ON e.id=o.run_id WHERE o.dispatched_at IS NULL AND e.state='QUEUED' ORDER BY o.created_at,o.run_id LIMIT 5",
  ).all<{ run_id: string }>();
  await Promise.allSettled(rows.results.map((r) => dispatch(env, r.run_id)));
  const failed = await env.DB.prepare(
    "SELECT id FROM evaluations WHERE publication_status IN('FAILED','PENDING') AND state IN('COMPLETED','FAILED','SUPERSEDED') ORDER BY publication_attempted_at IS NOT NULL,publication_attempted_at,created_at,id LIMIT 2",
  ).all<{ id: string }>();
  const { publish } = await import('./github-checks');
  for (const row of failed.results) {
    const run = await getRun(env, row.id);
    if (run) await publish(env, run).catch(() => {});
  }
}
export function parseContract(run: Run): Contract {
  return JSON.parse(run.contract_snapshot) as Contract;
}
