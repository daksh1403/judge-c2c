import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import type { Env } from './env';
import { canonical, digest, type Evidence } from './domain';
import { GitHub } from './github';
import { deterministicReport } from './evaluate';
import {
  preparePublicSnapshot,
  collectPublicEvidence,
} from './preview-evaluate';
import {
  previewEnabled,
  previewRequestSchema,
  type PreviewRun,
  type PreviewSnapshot,
} from './preview';
import { redact } from './security';

export class PublicPreviewWorkflow extends WorkflowEntrypoint<
  Env,
  { runId: string }
> {
  private async get(id: string) {
    const run = await this.env.DB.prepare(
      'SELECT * FROM preview_runs WHERE id=?',
    )
      .bind(id)
      .first<PreviewRun>();
    if (!run) throw new Error('RUN_MISSING');
    return run;
  }
  private async transition(
    id: string,
    from: string,
    to: string,
    detail: string,
  ) {
    const event = canonical({
      state: to,
      detail,
      created_at: new Date().toISOString(),
    });
    await this.env.DB.prepare(
      "UPDATE preview_runs SET state=?,updated_at=CURRENT_TIMESTAMP,timeline=json_insert(timeline,'$[#]',json(?)) WHERE id=? AND state=?",
    )
      .bind(to, event, id, from)
      .run();
  }
  async run(event: WorkflowEvent<{ runId: string }>, step: WorkflowStep) {
    if (!previewEnabled(this.env)) throw new Error('PREVIEW_DISABLED');
    const id = event.payload.runId;
    try {
      await step.do(
        'freeze-public-submission',
        { retries: { limit: 1, delay: '10 seconds' }, timeout: '2 minutes' },
        async () => {
          const run = await this.get(id);
          if (run.snapshot) return;
          await this.transition(
            id,
            'QUEUED',
            'FETCHING',
            'Reading real public PR metadata and capturing exact commits',
          );
          const snapshot = await preparePublicSnapshot(
            new GitHub(),
            previewRequestSchema.parse(JSON.parse(run.request)),
          );
          await this.env.DB.prepare(
            "UPDATE preview_runs SET snapshot=?,snapshot_hash=? WHERE id=? AND snapshot IS NULL AND state='FETCHING'",
          )
            .bind(
              redact(canonical(snapshot)),
              await digest(canonical(snapshot)),
              id,
            )
            .run();
        },
      );
      await step.do(
        'objective-evidence',
        { retries: { limit: 1, delay: '10 seconds' }, timeout: '3 minutes' },
        async () => {
          const run = await this.get(id);
          if (run.evidence) return;
          await this.transition(
            id,
            'FETCHING',
            'CHECKING',
            'Comparing the frozen baseline and head; checking source assertions and protected paths',
          );
          const snapshot = JSON.parse(run.snapshot!) as PreviewSnapshot;
          const result = await collectPublicEvidence(new GitHub(), snapshot);
          await this.env.DB.prepare(
            "UPDATE preview_runs SET context=?,evidence=? WHERE id=? AND state='CHECKING'",
          )
            .bind(
              redact(canonical(result.context)),
              redact(canonical(result.evidence)),
              id,
            )
            .run();
        },
      );
      await step.do('synthesize', async () => {
        const run = await this.get(id);
        if (run.state === 'COMPLETED') return;
        await this.transition(
          id,
          'CHECKING',
          'SYNTHESIZING',
          'Assembling evidence-backed report without AI or unsupported functional verdicts',
        );
        const report = deterministicReport(
          JSON.parse(run.snapshot!) as PreviewSnapshot,
          JSON.parse(run.evidence!) as Evidence[],
        );
        await this.env.DB.prepare(
          "UPDATE preview_runs SET report=? WHERE id=? AND state='SYNTHESIZING'",
        )
          .bind(redact(canonical(report)), id)
          .run();
        await this.transition(
          id,
          'SYNTHESIZING',
          'COMPLETED',
          'Real public GitHub evidence saved; build, tests and functional correctness remain unverified',
        );
      });
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
          ? error.message
          : 'PUBLIC_REVIEW_FAILED';
      const run = await this.get(id);
      if (!['FAILED', 'COMPLETED'].includes(run.state)) {
        await this.env.DB.prepare(
          'UPDATE preview_runs SET failure_code=? WHERE id=?',
        )
          .bind(code, id)
          .run();
        await this.transition(id, run.state, 'FAILED', code);
      }
      console.error(
        JSON.stringify({ event: 'public_preview_failed', runId: id, code }),
      );
    }
    return { runId: id };
  }
}
