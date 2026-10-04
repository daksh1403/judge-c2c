import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import type { Env } from './env';
import { organizationEnv } from './organization';
import { EvaluationWorkflow } from './workflow';
export class OrganizationEvaluationWorkflow extends WorkflowEntrypoint<
  Env,
  { runId: string }
> {
  async run(event: WorkflowEvent<{ runId: string }>, step: WorkflowStep) {
    return new EvaluationWorkflow(
      this.ctx,
      await organizationEnv(this.env),
    ).run(event, step);
  }
}
