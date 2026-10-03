import type { Contract, Evidence } from './domain';
export type RequirementOutcome = {
  requirementId: string;
  mandatory: boolean;
  status: 'PASS' | 'PARTIAL' | 'FAIL' | 'UNVERIFIED';
  needsAttention: boolean;
  criteria: {
    criterionId: string;
    status: 'PASS' | 'FAIL' | 'UNVERIFIED';
    evidenceIds: string[];
    reason: string;
  }[];
};
// This deterministic projection never consumes AI scores or additional-work credit.
// Applicability cannot be waived: every frozen criterion remains represented.
export function requirementOutcomes(
  contract: Contract,
  evidence: Evidence[],
): RequirementOutcome[] {
  return contract.requirements.map((requirement) => {
    const criteria = requirement.criteria.map((criterion) => {
      const relevant = evidence.filter(
        (item) =>
          item.criterionId === criterion.id &&
          (criterion.kind !== 'functional' || item.kind === 'execution'),
      );
      const failed = relevant.some((item) => item.status === 'FAIL');
      const passed = relevant.some((item) => item.status === 'PASS');
      const status = failed
        ? ('FAIL' as const)
        : passed
          ? ('PASS' as const)
          : ('UNVERIFIED' as const);
      return {
        criterionId: criterion.id,
        status,
        evidenceIds: relevant.map((item) => item.id),
        reason:
          failed && passed
            ? 'Conflicting objective evidence; failure is retained for human review.'
            : failed
              ? 'An objective criterion check failed.'
              : passed
                ? 'A relevant objective criterion check passed.'
                : 'No relevant objective result verifies this criterion.',
      };
    });
    const passes = criteria.filter((c) => c.status === 'PASS').length;
    const failures = criteria.filter((c) => c.status === 'FAIL').length;
    const status =
      passes === criteria.length
        ? ('PASS' as const)
        : passes > 0
          ? ('PARTIAL' as const)
          : failures > 0
            ? ('FAIL' as const)
            : ('UNVERIFIED' as const);
    return {
      requirementId: requirement.id,
      mandatory: requirement.mandatory,
      status,
      needsAttention: status !== 'PASS',
      criteria,
    };
  });
}
