import { describe, it, expect } from 'vitest';
import { checkBody } from '../src/github-checks';
import { demoContract } from '../src/demo';
import type { Run } from '../src/store';
const run: Run = {
  id: '1'.repeat(64),
  repository_id: 1,
  pr_number: 2,
  head_sha: 'b'.repeat(40),
  baseline_sha: demoContract.baseline,
  contract_hash: 'c'.repeat(64),
  contract_snapshot: JSON.stringify(demoContract),
  assignment_snapshot: '{}',
  state: 'QUEUED',
  evidence: null,
  report: null,
  context: null,
  ai_status: null,
  failure_code: null,
  check_run_id: null,
  publication_status: 'PENDING',
  created_at: '2026-10-02',
};
describe('GitHub lifecycle status and judgment integrity', () => {
  it.each([
    'CREATED',
    'QUEUED',
    'FETCHING',
    'CHECKING',
    'REVIEWING',
    'SYNTHESIZING',
  ] as const)('does not conclude a %s run', (state) => {
    const body = checkBody(
      {
        PUBLIC_ORIGIN: 'https://judge.example',
        EVALUATION_DETAILS_KIND: 'organization',
      },
      { ...run, state },
    );
    expect(body.status).toBe(
      ['CREATED', 'QUEUED'].includes(state) ? 'queued' : 'in_progress',
    );
    expect(body).not.toHaveProperty('conclusion');
    expect(body.head_sha).toBe(run.head_sha);
    expect(body.output.summary).toContain('No final judgment');
    expect(body.details_url).toContain('?organization=1&evaluation=' + run.id);
  });
  it.each([
    ['FAILED', 'action_required'],
    ['SUPERSEDED', 'cancelled'],
  ] as const)('publishes %s as %s', (state, conclusion) => {
    const body = checkBody({}, { ...run, state });
    expect(body.status).toBe('completed');
    expect(body.conclusion).toBe(conclusion);
  });
  it('requires attention when functional evidence is unavailable', () => {
    expect(checkBody({}, { ...run, state: 'COMPLETED' }).conclusion).toBe(
      'action_required',
    );
  });
});
