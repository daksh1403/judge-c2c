import { updateAssignmentProgress } from './competition-completion';
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import type { Env } from './env';
import {
  getRun,
  isCurrent,
  parseContract,
  transition,
  type Run,
} from './store';
import { GitHub } from './github';
import { classifyRisk, objective, aiReview, type Context } from './evaluate';
import { canonical, digest, type Evidence } from './domain';
import { redact } from './security';
import { runObjective } from './runner';

export class EvaluationWorkflow extends WorkflowEntrypoint<
  Env,
  { runId: string }
> {
  async run(event: WorkflowEvent<{ runId: string }>, step: WorkflowStep) {
    const id = event.payload.runId;
    try {
      const context = await step.do(
        'prepare',
        {
          retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
          timeout: '3 minutes',
        },
        async () => {
          const run = await this.requireCurrent(id);
          if (!run) return null;
          await transition(this.env, id, 'QUEUED', 'FETCHING');
          const c = parseContract(run);
          const github = await GitHub.installation(this.env, c);
          const pr = await github.api<{
            title: string;
            body: string | null;
            head: { sha: string };
            state: string;
          }>(`/repos/${c.repository.fullName}/pulls/${run.pr_number}`);
          if (pr.head.sha !== run.head_sha || pr.state !== 'open') {
            await this.supersede(run);
            return null;
          }
          const files = await github.compare(c, run.head_sha);
          const commitContext = await github.api<{
            commits?: { sha: string; commit: { message: string } }[];
          }>(
            `/repos/${c.repository.fullName}/compare/${c.baseline}...${run.head_sha}?per_page=100`,
          );
          const commits = commitContext.commits ?? [];
          // Native PR head was verified separately. Commit context is bounded and may be partial.
          const paths = [
            ...new Set([
              ...files
                .filter(
                  (f) =>
                    !/lock|generated|\.min\.|\.(png|jpg|pdf|zip)$/.test(
                      f.filename,
                    ),
                )
                .slice(0, 8)
                .map((f) => f.filename),
              ...c.requirements.flatMap((r) =>
                r.criteria.flatMap((a) =>
                  a.verification.type === 'file_contains'
                    ? [a.verification.path]
                    : [],
                ),
              ),
            ]),
          ];
          if (paths.length > 30) throw new Error('CONTEXT_LIMIT');
          const sources: Context['sources'] = {};
          // Limit parallel GitHub requests and cumulative context size.
          for (let i = 0; i < paths.length; i += 4)
            await Promise.all(
              paths.slice(i, i + 4).map(async (path) => {
                const [baseline, head] = await Promise.all([
                  github.file(
                    c.repository.fullName,
                    c.baseline,
                    path,
                    c.execution.maxFileBytes,
                  ),
                  github.file(
                    c.repository.fullName,
                    run.head_sha,
                    path,
                    c.execution.maxFileBytes,
                  ),
                ]);
                sources[path] = { baseline, head };
              }),
            );
          const result: Context = {
            files: files.map((f) => ({
              ...f,
              patch: f.patch ? redact(f.patch).slice(0, 5000) : undefined,
            })),
            sources,
            pullRequest: {
              title: redact(pr.title ?? '').slice(0, 1000),
              description: redact(pr.body ?? '').slice(0, 6000),
              head: run.head_sha,
            },
            commits: commits.map((commit) => ({
              sha: commit.sha,
              message: redact(commit.commit.message).slice(0, 500),
            })),
            risk: classifyRisk(files),
            environment: c.execution.environment,
            toolVersion: 'judge-c2c-0.1.0',
          };
          const size = canonical(result).length;
          if (size > 750_000) throw new Error('CONTEXT_LIMIT');
          // Never persist raw source credentials. Source assertions run on the in-memory data;
          // stored context is redacted and includes raw hashes for audit without secret values.
          const evidence = objective(c, result);
          const stored = redact(
            canonical({
              ...result,
              sources: Object.fromEntries(
                await Promise.all(
                  Object.entries(sources).map(async ([path, s]) => [
                    path,
                    {
                      baseline: s.baseline === null ? null : redact(s.baseline),
                      head: s.head === null ? null : redact(s.head),
                      baselineHash:
                        s.baseline === null ? null : await digest(s.baseline),
                      headHash: s.head === null ? null : await digest(s.head),
                    },
                  ]),
                ),
              ),
            }),
          );
          await this.env.DB.prepare(
            "UPDATE evaluations SET context=?,evidence=? WHERE id=? AND state='FETCHING'",
          )
            .bind(stored, redact(canonical(evidence)), id)
            .run();
          return JSON.parse(stored) as Context;
        },
      );
      if (!context) return { status: 'superseded' };
      await step.do('objective', async () => {
        const run = await this.requireCurrent(id);
        if (!run) return;
        await transition(
          this.env,
          id,
          'FETCHING',
          'CHECKING',
          'Baseline source assertions and policy checks recorded',
        );
        const contract = parseContract(run);
        let evidence = JSON.parse(run.evidence!) as Evidence[];
        try {
          evidence = await runObjective(this.env, run, contract, evidence);
        } catch (error) {
          const code =
            error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
              ? error.message
              : 'RUNNER_UNAVAILABLE';
          evidence.push({
            id: 'runner-stage',
            kind: 'execution',
            status: 'UNVERIFIED',
            claim: `Execution stage unavailable: ${code}. Earlier evidence is preserved.`,
          });
        }
        if (!(await isCurrent(this.env, run))) return;
        await this.env.DB.prepare(
          "UPDATE evaluations SET evidence=? WHERE id=? AND state='CHECKING'",
        )
          .bind(redact(canonical(evidence)), id)
          .run();
        if (this.env.ARTIFACTS) {
          const content = redact(canonical(evidence));
          const key = `evaluations/${id}/objective.json`;
          const hash = await digest(content);
          await this.env.ARTIFACTS.put(key, content, {
            httpMetadata: { contentType: 'application/json' },
            customMetadata: { sha256: hash },
          });
          await this.env.DB.prepare(
            'INSERT OR IGNORE INTO artifacts(key,run_id,sha256,bytes,content_type) VALUES(?,?,?,?,?)',
          )
            .bind(
              key,
              id,
              hash,
              new TextEncoder().encode(content).length,
              'application/json',
            )
            .run();
        }
      });
      await step.do(
        'reasoning',
        { retries: { limit: 0, delay: '1 second' }, timeout: '3 minutes' },
        async () => {
          const run = await this.requireCurrent(id);
          if (!run) return;
          await transition(this.env, id, 'CHECKING', 'REVIEWING');
          const evidence = JSON.parse(run.evidence!) as Evidence[];
          const result = await aiReview(
            this.env,
            parseContract(run),
            context,
            evidence,
          );
          await this.env.DB.prepare(
            "UPDATE evaluations SET report=?,ai_status=? WHERE id=? AND state='REVIEWING'",
          )
            .bind(
              redact(canonical({ ...result.review, aiTrace: result.trace })),
              result.status,
              id,
            )
            .run();
        },
      );
      await step.do('synthesize', async () => {
        const run = await this.requireCurrent(id);
        if (!run) return;
        await transition(this.env, id, 'REVIEWING', 'SYNTHESIZING');
        await transition(
          this.env,
          id,
          'SYNTHESIZING',
          'COMPLETED',
          'Evidence-backed report; inspect execution availability per criterion',
        );
      });
    } catch (error) {
      const run = await getRun(this.env, id);
      const code =
        error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
          ? error.message
          : 'STAGE_FAILED';
      if (run && !['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(run.state)) {
        await transition(this.env, id, run.state, 'FAILED', code);
        await this.env.DB.prepare(
          'UPDATE evaluations SET failure_code=? WHERE id=?',
        )
          .bind(code, id)
          .run();
      }
      console.error(
        JSON.stringify({ event: 'evaluation_failed', runId: id, code }),
      );
    }
    await step.do('assignment-progress', () =>
      updateAssignmentProgress(this.env, id),
    );
    // Publication is its own retryable stage; failures cannot erase completed evidence.
    await step.do(
      'publish',
      {
        retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
        timeout: '1 minute',
      },
      async () => {
        const run = await getRun(this.env, id);
        if (!run) return;
        await publish(this.env, run);
      },
    );
    return { runId: id };
  }
  private async requireCurrent(id: string) {
    const run = await getRun(this.env, id);
    if (!run) throw new Error('RUN_MISSING');
    if (!(await isCurrent(this.env, run))) {
      await this.supersede(run);
      return null;
    }
    return run;
  }
  private async supersede(run: Run) {
    const current = await getRun(this.env, run.id);
    if (
      current &&
      !['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(current.state)
    )
      await transition(
        this.env,
        run.id,
        current.state,
        'SUPERSEDED',
        'New head or closed PR',
      );
  }
}
export async function publish(env: Env, run: Run) {
  const c = parseContract(run);
  const github = await GitHub.installation(env, c);
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
    status: 'completed',
    conclusion,
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
      summary: `${report?.summary ?? run.failure_code ?? 'Evaluation superseded.'}\n\nBaseline: ${run.baseline_sha}\nHead: ${run.head_sha}\nContract: ${run.contract_hash}\nObjective evidence: ${evidence.filter((e) => e.status === 'PASS').length} pass, ${evidence.filter((e) => e.status === 'FAIL').length} fail, ${evidence.filter((e) => e.status === 'UNVERIFIED').length} unverified.\n${evidence.some((e) => e.kind === 'execution' && e.baselineStatus) ? 'Baseline and submission execution evidence is available; inspect trusted acceptance versus supplemental repository commands.' : 'No verified runtime results are available.'}`,
    },
  };
  try {
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
