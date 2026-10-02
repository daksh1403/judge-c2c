import type { Env } from './env';
import { getRun, parseContract, type Run } from './store';
import { GitHub } from './github';
import type { Evidence } from './domain';
export function checkBody(
  env: Pick<Env, 'PUBLIC_ORIGIN' | 'EVALUATION_DETAILS_KIND'>,
  run: Run,
) {
  const c = parseContract(run);
  const terminal = ['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(run.state);
  const evidence = run.evidence ? (JSON.parse(run.evidence) as Evidence[]) : [];
  const hasFailure = evidence.some(
    (e) =>
      e.status === 'FAIL' &&
      (e.criterionId || e.kind === 'policy' || e.baselineStatus === 'PASS'),
  );
  const uncertain =
    evidence.some((e) => e.status === 'UNVERIFIED') ||
    c.requirements.some((r) =>
      r.criteria.some(
        (a) =>
          a.kind === 'functional' &&
          !evidence.some(
            (e) =>
              e.criterionId === a.id &&
              e.kind === 'execution' &&
              e.status !== 'UNVERIFIED',
          ),
      ),
    );
  const report = run.report
    ? (JSON.parse(run.report) as { summary: string })
    : null;
  const conclusion =
    run.state === 'SUPERSEDED'
      ? 'cancelled'
      : run.state === 'FAILED'
        ? 'action_required'
        : hasFailure
          ? 'failure'
          : uncertain || run.ai_status === 'FAILED'
            ? 'action_required'
            : 'neutral';
  const body = {
    name: 'Judge-C2C',
    head_sha: run.head_sha,
    external_id: run.id,
    status: terminal
      ? 'completed'
      : ['CREATED', 'QUEUED'].includes(run.state)
        ? 'queued'
        : 'in_progress',
    ...(terminal ? { conclusion } : {}),
    ...(env.PUBLIC_ORIGIN
      ? {
          details_url: `${env.PUBLIC_ORIGIN}/${env.EVALUATION_DETAILS_KIND === 'organization' ? '?organization=1&evaluation=' : '?run='}${run.id}`,
        }
      : {}),
    output: {
      title:
        run.state === 'COMPLETED'
          ? 'Evidence review complete — human judging remains required'
          : `Evaluation ${run.state.toLowerCase()}`,
      summary: `${report?.summary ?? run.failure_code ?? (terminal ? 'Evaluation superseded.' : 'Evaluation is underway. No final judgment has been made.')}\n\nBaseline: ${run.baseline_sha}\nHead: ${run.head_sha}\nContract: ${run.contract_hash}\nObjective evidence: ${evidence.filter((e) => e.status === 'PASS').length} pass, ${evidence.filter((e) => e.status === 'FAIL').length} fail, ${evidence.filter((e) => e.status === 'UNVERIFIED').length} unverified.\n${evidence.some((e) => e.kind === 'execution' && e.baselineStatus) ? 'Baseline and submission execution evidence is available; inspect trusted acceptance versus supplemental repository commands.' : 'No verified runtime results are available.'}`,
    },
  };
  return body;
}
export async function publish(env: Env, input: Run) {
  // Re-read run state before publishing; workflow progress stages are sequential.
  const run = await getRun(env, input.id);
  if (!run) return;
  const c = parseContract(run);
  const body = checkBody(env, run);
  try {
    await env.DB.prepare(
      'UPDATE evaluations SET publication_attempted_at=CURRENT_TIMESTAMP WHERE id=?',
    )
      .bind(run.id)
      .run();
    const github = await GitHub.installation(env, c);
    let checkId = run.check_run_id;
    if (!checkId) {
      // Recover after create succeeded but DB acknowledgement failed.
      const existing = await github.api<{
        check_runs: { id: number; external_id: string }[];
      }>(
        `/repos/${c.repository.fullName}/commits/${run.head_sha}/check-runs?check_name=Judge-C2C&filter=all&per_page=100`,
      );
      checkId =
        existing.check_runs.find((x) => x.external_id === run.id)?.id ?? null;
    }
    const result = await github.api<{ id: number }>(
      `/repos/${c.repository.fullName}/check-runs${checkId ? '/' + checkId : ''}`,
      { method: checkId ? 'PATCH' : 'POST', body: JSON.stringify(body) },
    );
    await env.DB.prepare(
      "UPDATE evaluations SET check_run_id=?,publication_status='PUBLISHED' WHERE id=?",
    )
      .bind(result.id, run.id)
      .run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE evaluations SET publication_status='FAILED' WHERE id=?",
    )
      .bind(run.id)
      .run();
    throw error;
  }
}
