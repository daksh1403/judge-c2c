import type { Evidence } from './domain';
export type AttentionItem = {
  code: string;
  what: string;
  why: string;
  inspect: string[];
  action: string;
};
export function attentionItems(
  run: {
    state: string;
    ai_status: string | null;
    failure_code?: string | null;
    report?: string | null;
  },
  evidence: Evidence[],
): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (run.state === 'FAILED')
    items.push({
      code: 'EVALUATION_FAILED',
      what: `Evaluation failed: ${run.failure_code ?? 'stage unavailable'}.`,
      why: 'An incomplete stage cannot establish a safe final judgment.',
      inspect: ['timeline'],
      action:
        'Inspect preserved evidence and retry as a new attempt after recovery.',
    });
  if (run.ai_status !== 'COMPLETED')
    items.push({
      code: 'AI_UNAVAILABLE',
      what: `AI review is ${run.ai_status ?? 'pending'}.`,
      why: 'Contextual engineering review has not completed; objective results remain authoritative.',
      inspect: ['ai-trace'],
      action: 'Inspect the reason, review manually or retry after recovery.',
    });
  let trace: {
    requiresHumanAttention?: boolean;
    groundingPolicy?: string;
    qualitativeClaimRejections?: { path: string; reason: string }[];
  } = {};
  try {
    trace = JSON.parse(run.report ?? '{}').aiTrace ?? {};
  } catch {
    /* Missing report */
  }
  if (trace.qualitativeClaimRejections?.length)
    items.push({
      code: 'AI_CLAIMS_REJECTED',
      what: `${trace.qualitativeClaimRejections.length} unsupported AI claim(s) were discarded.`,
      why: 'The reviewer supplied insufficient evidence; automation cannot replace missing qualitative judgment.',
      inspect: ['solution-approach', 'objective-checks', 'ai-trace'],
      action:
        'Inspect trusted evidence and record a human decision. Rejected claims remain UNVERIFIED.',
    });
  if (
    trace.requiresHumanAttention ||
    (run.ai_status === 'COMPLETED' &&
      trace.groundingPolicy !== 'objective-facts-unverified-narratives-v1')
  )
    items.push({
      code: 'AI_CLAIMS_UNVERIFIED',
      what: 'AI narratives require human verification.',
      why: 'Citation presence does not prove semantic support; unsupported observations are downgraded.',
      inspect: ['solution-approach', 'engineering-review'],
      action:
        'Compare each interpretation with its linked evidence; retain UNVERIFIED when unsupported.',
    });
  const protectedTests = evidence.filter(
    (e) => e.kind === 'policy' && e.status === 'FAIL',
  );
  if (protectedTests.length)
    items.push({
      code: 'PROTECTED_PATH_CHANGED',
      what: 'Protected evaluation paths were changed.',
      why: 'Participant changes cannot redefine trusted tests or judging rules.',
      inspect: protectedTests.map((e) => e.id),
      action:
        'Inspect the exact diff and policy violation before any acceptance decision.',
    });
  const regressions = evidence.filter(
    (e) =>
      e.status === 'FAIL' && e.baselineStatus === 'PASS' && e.kind !== 'policy',
  );
  if (regressions.length)
    items.push({
      code: 'REGRESSION',
      what: 'Passing baseline evidence became a submission failure.',
      why: 'New functionality cannot excuse a regression in preserved behavior.',
      inspect: regressions.map((e) => e.id),
      action:
        'Inspect baseline/head results and request changes or record an explicit reviewed decision.',
    });
  const security = evidence.filter(
    (e) => /security-|dependency-/.test(e.id) && e.status !== 'PASS',
  );
  if (security.length)
    items.push({
      code: 'SECURITY_REVIEW',
      what: 'Security evidence reports a concern or unavailable scan.',
      why: 'Source suspicion and package advisories do not establish exploitability; absent scans cannot prove safety.',
      inspect: security.map((e) => e.id),
      action:
        'Inspect advisory/source evidence; handle confidential vulnerability details through restricted security intake.',
    });
  const unavailable = evidence.filter(
    (e) => e.status === 'UNVERIFIED' && e.kind === 'execution',
  );
  if (unavailable.length)
    items.push({
      code: 'EXECUTION_UNVERIFIED',
      what: 'Execution or a critical criterion is unverified.',
      why: 'No successful trusted execution establishes this behavior.',
      inspect: unavailable.map((e) => e.id),
      action:
        'Inspect preparation/check failures, recover the runner and retry as a new attempt.',
    });
  return items;
}
