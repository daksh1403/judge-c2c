import { providerHasKey } from './external-review';
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
  acquirePreparation,
  coolDownReviewer,
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
      let context: Context | null = null;
      let preparationFinished = false;
      for (let attempt = 0; attempt < 240; attempt++) {
        const prepared = await step.do(
          attempt === 0 ? 'prepare' : `prepare-${attempt}`,
          {
            retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
            timeout: '3 minutes',
          },
          async () => {
            const run = await this.requireCurrent(id);
            if (!run) return null;
            const slot = await acquirePreparation(
              this.env.CAPACITY_DB ?? this.env.DB,
            );
            if (!slot) return 'CONTEXT_BUSY' as const;
            try {
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
              for (let i = 0; i < paths.length; i += 4) {
                if (
                  !(await renewReviewer(
                    this.env.CAPACITY_DB ?? this.env.DB,
                    slot,
                  ))
                )
                  throw new Error('PREPARATION_LEASE_EXPIRED');
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
              }
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
                          baseline:
                            s.baseline === null ? null : redact(s.baseline),
                          head: s.head === null ? null : redact(s.head),
                          baselineHash:
                            s.baseline === null
                              ? null
                              : await digest(s.baseline),
                          headHash:
                            s.head === null ? null : await digest(s.head),
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
            } finally {
              await releaseReviewer(this.env.CAPACITY_DB ?? this.env.DB, slot);
            }
          },
        );
        if (prepared !== 'CONTEXT_BUSY') {
          context = prepared;
          preparationFinished = true;
          break;
        }
        await step.sleep(`preparation-wait-${attempt}`, '30 seconds');
      }
      if (!preparationFinished) throw new Error('PREPARATION_QUEUE_TIMEOUT');
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
          retries: {
            limit: this.env.RUNNER_BACKEND === 'actions-vm' ? 600 : 8,
            delay:
              this.env.RUNNER_BACKEND === 'actions-vm'
                ? '30 seconds'
                : '15 seconds',
            backoff: 'constant',
          },
          timeout:
            this.env.RUNNER_BACKEND === 'actions-vm'
              ? '10 minutes'
              : '4 minutes',
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
            evidence = await runObjective(this.env, run, contract, evidence, {
              deferActions: this.env.RUNNER_BACKEND === 'actions-vm',
            });
          } catch (error) {
            // Capacity is backpressure, not missing verification. Durable retries
            // re-check current head/eligibility before spending more compute.
            if (
              error instanceof Error &&
              ['RUNNER_BUSY', 'RUNNER_PENDING', 'GITHUB_RATE_LIMITED'].includes(
                error.message,
              )
            ) {
              await this.env.DB.prepare(
                'INSERT OR IGNORE INTO timeline(run_id,state,detail) SELECT id,state,? FROM evaluations WHERE id=?',
              )
                .bind(
                  'Waiting for isolated execution capacity; frozen inputs and completed baseline evidence are retained.',
                  id,
                )
                .run();
              throw error;
            }
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
      // Sleep outside step.do so waiting does not occupy active Workflow capacity.
      // Never durably cache an ephemeral lease across steps: acquire, use and
      // release it within the same bounded reasoning step, including on resume.
      let reasoningFinished = false;
      let providerRetries = 0;
      for (let attempt = 0; attempt < 600; attempt++) {
        const waiting = await step.do(
          attempt === 0 ? 'reasoning' : `reasoning-${attempt}`,
          {
            retries: { limit: 0, delay: '1 second' },
            timeout: '3 minutes',
          },
          async () => {
            if (!(await this.requireCurrent(id))) return false;
            const reviewerSlot =
              (this.env.AI_PROVIDER ?? 'cloudflare') !== 'cloudflare' &&
              providerHasKey(this.env)
                ? await acquireReviewer(
                    this.env.CAPACITY_DB ?? this.env.DB,
                    this.env.AI_PROVIDER ?? 'cloudflare',
                  )
                : null;
            if (
              (this.env.AI_PROVIDER ?? 'cloudflare') !== 'cloudflare' &&
              providerHasKey(this.env) &&
              !reviewerSlot
            ) {
              if (attempt === 0)
                await this.env.DB.prepare(
                  'INSERT OR IGNORE INTO timeline(run_id,state,detail) SELECT id,state,? FROM evaluations WHERE id=?',
                )
                  .bind(
                    'Waiting for AI reviewer capacity; submission and earlier evidence are retained.',
                    id,
                  )
                  .run();
              return true;
            }
            let coolingDown = false;
            try {
              const run = await this.requireCurrent(id);
              if (!run) return;
              if (
                reviewerSlot &&
                !(await renewReviewer(
                  this.env.CAPACITY_DB ?? this.env.DB,
                  reviewerSlot,
                ))
              )
                throw new Error('REVIEWER_LEASE_EXPIRED');
              if (!(await this.requireCurrent(id))) return;
              if (
                run.state !== 'REVIEWING' &&
                !(await transition(this.env, id, 'CHECKING', 'REVIEWING'))
              )
                return;
              if (!(await this.requireCurrent(id))) return;
              const evidence = JSON.parse(run.evidence!) as Evidence[];
              const result = await aiReview(
                this.env,
                parseContract(run),
                context,
                evidence,
              );
              await this.env.DB.prepare(
                'INSERT INTO audit(action,entity,actor,changes) VALUES(?,?,?,?)',
              )
                .bind(
                  'reviewer.attempt',
                  id,
                  'system',
                  redact(
                    canonical({
                      id: crypto.randomUUID(),
                      status: result.status,
                      review: result.review,
                      trace: result.trace,
                    }),
                  ),
                )
                .run();
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
              const failure =
                result.trace.failureCode ??
                result.trace.attemptFailures?.at(-1) ??
                '';
              if (
                result.status === 'FAILED' &&
                providerRetries < 5 &&
                /^(GEMINI|GROQ|CALLMISSED)_(HTTP_(429|5\d\d)|TIMEOUT|UNAVAILABLE)$/.test(
                  failure,
                )
              ) {
                if (reviewerSlot)
                  coolingDown = await coolDownReviewer(
                    this.env.CAPACITY_DB ?? this.env.DB,
                    reviewerSlot,
                    Math.min(300000, 60000 * 2 ** providerRetries),
                  );
                await this.env.DB.prepare(
                  'INSERT OR IGNORE INTO timeline(run_id,state,detail) SELECT id,state,? FROM evaluations WHERE id=?',
                )
                  .bind(
                    `AI provider temporarily unavailable (${failure}); attempt ${providerRetries + 1} retained and a bounded retry is scheduled.`,
                    id,
                  )
                  .run();
                return 'PROVIDER_BUSY' as const;
              }
            } finally {
              if (reviewerSlot && !coolingDown)
                await releaseReviewer(
                  this.env.CAPACITY_DB ?? this.env.DB,
                  reviewerSlot,
                );
            }
            return false;
          },
        );
        if (!waiting) {
          reasoningFinished = true;
          break;
        }
        if (waiting === 'PROVIDER_BUSY') providerRetries++;
        await step.sleep(
          `reviewer-wait-${attempt}`,
          `${waiting === 'PROVIDER_BUSY' ? Math.min(300, 30 * 2 ** (providerRetries - 1)) : 30} seconds`,
        );
      }
      if (!reasoningFinished) throw new Error('REVIEWER_QUEUE_TIMEOUT');
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
