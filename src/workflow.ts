import { discoverAdditionalContributions } from './additional-contributions';
import { enrichEngineeringReview } from './engineering-review';
import { repositoryIndex } from './repository-intelligence';
import {
  captureRunMeasurements,
  recordRunMeasurement,
} from './run-measurements';
import { captureRunArtifacts } from './artifact-store';
import {
  acquireReviewer,
  releaseReviewer,
  renewReviewer,
} from './reviewer-capacity';
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
import { publish } from './github-checks';
import { cachedDependencyAudit } from './dependency-audit-cache';
export { publish } from './github-checks';

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
          // A status outage must not prevent objective evidence collection.
          await publish(this.env, (await getRun(this.env, id))!).catch(
            () => {},
          );
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
              ...(c.analysis?.dependencyAudit === 'OSV_NPM_V1'
                ? ['package.json', 'package-lock.json']
                : []),
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
              patchTruncated:
                f.patchTruncated || (!!f.patch && f.patch.length > 5000),
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
            toolVersion: 'judge-c2c-0.1.1',
          };
          const indexed = await repositoryIndex(
            this.env.DB,
            c.repository.id,
            c.baseline,
            run.head_sha,
            result,
          );
          result.repositoryIntelligence = indexed.index;
          result.repositoryIndexCache = indexed.cache;
          const size = canonical(result).length;
          if (size > 750_000) throw new Error('CONTEXT_LIMIT');
          // Never persist raw source credentials. Source assertions run on the in-memory data;
          // stored context is redacted and includes raw hashes for audit without secret values.
          const evidence = objective(c, result);
          if (c.analysis?.dependencyAudit === 'OSV_NPM_V1') {
            const scanStarted = Date.now();
            evidence.push(
              ...(await cachedDependencyAudit(
                this.env.DB,
                {
                  repositoryId: c.repository.id,
                  runId: id,
                  baseline: c.baseline,
                  head: run.head_sha,
                  contractHash: run.contract_hash,
                  cache: c.execution.runner?.cache ?? 'NONE',
                },
                {
                  manifest: sources['package.json']?.baseline ?? null,
                  lock: sources['package-lock.json']?.baseline ?? null,
                },
                {
                  manifest: sources['package.json']?.head ?? null,
                  lock: sources['package-lock.json']?.head ?? null,
                },
              )),
            );
            await recordRunMeasurement(
              this.env.DB,
              id,
              'check.scan.durationMs',
              Date.now() - scanStarted,
            ).catch(() => undefined);
          }
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
      if (!context) {
        await step.do(
          'publish-superseded',
          {
            retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
            timeout: '1 minute',
          },
          async () => {
            const run = await getRun(this.env, id);
            if (run) await publish(this.env, run);
          },
        );
        return { status: 'superseded' };
      }
      await step.do(
        'objective',
        {
          retries: { limit: 8, delay: '15 seconds', backoff: 'constant' },
          timeout: '4 minutes',
        },
        async () => {
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
            // Capacity is backpressure, not missing verification. Durable retries
            // re-check current head/eligibility before spending more compute.
            if (error instanceof Error && error.message === 'RUNNER_BUSY')
              throw error;
            const code =
              error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
                ? error.message
                : 'RUNNER_UNAVAILABLE';
            await recordRunMeasurement(
              this.env.DB,
              id,
              'runner.failure',
              1,
            ).catch(() => undefined);
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
          if (this.env.ARTIFACTS || this.env.ARTIFACT_KV) {
            // Artifact outages cannot erase objective evidence or prevent reasoning.
            await captureRunArtifacts(this.env, id).catch(() => null);
          }
        },
      );
      const reviewerSlot = await step.do(
        'reviewer-capacity',
        { retries: { limit: 16, delay: '15 seconds', backoff: 'constant' } },
        async () => {
          if (
            !(await this.requireCurrent(id)) ||
            this.env.AI_PROVIDER !== 'callmissed' ||
            !this.env.CALLMISSED_API_KEY
          )
            return null;
          const slot = await acquireReviewer(this.env.DB, 'callmissed');
          if (!slot) throw new Error('REVIEWER_CAPACITY_BUSY');
          return slot;
        },
      );
      await step.do(
        'reasoning',
        {
          retries: { limit: 0, delay: '1 second' },
          timeout: '3 minutes',
        },
        async () => {
          try {
            const run = await this.requireCurrent(id);
            if (!run) return;
            if (
              reviewerSlot &&
              !(await renewReviewer(this.env.DB, reviewerSlot))
            )
              throw new Error('REVIEWER_LEASE_EXPIRED');
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
                redact(
                  canonical({
                    ...result.review,
                    ...enrichEngineeringReview(
                      parseContract(run),
                      evidence,
                      result.review,
                      result.status === 'COMPLETED'
                        ? 'AI_ASSESSMENT'
                        : 'DETERMINISTIC_POLICY',
                      context,
                    ),
                    aiTrace: result.trace,
                  }),
                ),
                result.status,
                id,
              )
              .run();
          } finally {
            if (reviewerSlot) await releaseReviewer(this.env.DB, reviewerSlot);
          }
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
      await step.do('discover-additional-contributions', () =>
        discoverAdditionalContributions(this.env, id),
      );
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
    await step.do('capture-final-artifacts', async () => {
      if (!this.env.ARTIFACTS && !this.env.ARTIFACT_KV) return;
      const result = await captureRunArtifacts(this.env, id).catch(() => null);
      if (!result || result.status === 'PARTIAL') {
        await this.env.DB.prepare(
          'INSERT OR IGNORE INTO timeline(run_id,state,detail) SELECT id,state,? FROM evaluations WHERE id=?',
        )
          .bind(
            'Artifact capture incomplete; objective evidence remains in the evaluation bundle.',
            id,
          )
          .run();
      }
    });
    await step.do('operational-measurements', () =>
      captureRunMeasurements(this.env.DB, id).catch(() => undefined),
    );
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
