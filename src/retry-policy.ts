import type { Run } from './store';
import { AI_POLICY_VERSION } from './evaluate';
import type { Evidence } from './domain';
/** Infrastructure failure is retryable even when advisory AI completed successfully. */
export function retryableRun(
  run: Pick<Run, 'state' | 'ai_status' | 'report' | 'evidence'>,
) {
  if (run.state === 'FAILED') return true;
  if (run.state !== 'COMPLETED') return false;
  if (
    [
      'FAILED',
      'SKIPPED_CONTEXT_LIMIT',
      'NOT_CONFIGURED',
      'NEEDS_REVIEW',
    ].includes(run.ai_status ?? '')
  )
    return true;
  let report: { aiTrace?: { policy?: string } } = {},
    evidence: Evidence[] = [];
  try {
    report = JSON.parse(run.report ?? '{}');
    evidence = JSON.parse(run.evidence ?? '[]');
  } catch {
    return false;
  }
  return (
    report.aiTrace?.policy !== AI_POLICY_VERSION ||
    evidence.some(
      (e) =>
        e.status === 'UNVERIFIED' &&
        (e.id === 'runner-stage' || e.kind === 'execution'),
    )
  );
}
