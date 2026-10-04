import type { Contract, Evidence, Review } from './domain';
import { requirementOutcomes } from './requirement-assessment';

export const GROUNDING_POLICY = 'objective-facts-unverified-narratives-v1';
// Citation validity does not establish semantic truth. Only exact objective facts
// enter the observed layer; contextual prose always remains reviewable inference.
export function groundReview(
  value: Review,
  contract: Contract,
  evidence: Evidence[],
) {
  const review = structuredClone(value);
  const known = new Map(evidence.map((item) => [item.id, item]));
  const criteria = requirementOutcomes(contract, evidence).flatMap(
    (item) => item.criteria,
  );
  review.assessments = criteria.map((item) => ({
    criterionId: item.criterionId,
    status: item.status,
    explanation: item.reason,
    evidenceIds: item.evidenceIds,
  }));
  const counts = { PASS: 0, FAIL: 0, UNVERIFIED: 0 };
  for (const criterion of criteria) counts[criterion.status]++;
  review.summary = `Objective criteria: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.UNVERIFIED} UNVERIFIED. Contextual AI narratives are unverified interpretation and require human review; citations do not prove their semantic truth.`;
  const downgradedObservationPaths: string[] = [];
  const unverifiedNarrativePaths: string[] = [];
  const approach = review.solution_approach;
  const fields = [
    'problem_understanding',
    'approach_summary',
    'solution_design',
    'correctness',
    'maintainability',
    'architecture_fit',
  ] as const;
  const entries = fields.map((field) => ({
    path: `solution_approach.${field}`,
    observation: approach[field],
  }));
  for (const field of [
    'strengths',
    'weaknesses',
    'tradeoffs',
    'unverified_assumptions',
  ] as const) {
    approach[field].forEach((observation, index) =>
      entries.push({
        path: `solution_approach.${field}[${index}]`,
        observation,
      }),
    );
  }
  for (const { path, observation } of entries) {
    const exactFact = observation.evidenceIds.some((id) => {
      const fact = known.get(id);
      return (
        fact &&
        fact.status !== 'UNVERIFIED' &&
        observation.text.trim() === fact.claim.trim() &&
        (path !== 'solution_approach.correctness' ||
          (fact.kind === 'execution' && !!fact.criterionId))
      );
    });
    if (observation.verification === 'OBSERVED' && !exactFact) {
      observation.verification = 'UNVERIFIED';
      downgradedObservationPaths.push(path);
    }
    if (observation.verification !== 'OBSERVED')
      unverifiedNarrativePaths.push(path);
  }
  review.findings.forEach((finding, index) => {
    const prefix = 'UNVERIFIED AI interpretation: ';
    finding.claim = prefix + finding.claim.slice(0, 2000 - prefix.length);
    unverifiedNarrativePaths.push(`findings[${index}]`);
  });
  return {
    review,
    grounding: {
      groundingPolicy: GROUNDING_POLICY,
      downgradedObservationPaths,
      unverifiedNarrativePaths,
      requiresHumanAttention: unverifiedNarrativePaths.length > 0,
    },
  };
}

/** Missing model criterion echoes can be recovered only from deterministic facts.
 * Existing model entries still pass full validation; contradictions are rejected. */
export function completeObjectiveAssessments(
  value: unknown,
  contract: Contract,
  evidence: Evidence[],
) {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { assessments?: unknown }).assessments)
  )
    return { value, filledCriterionIds: [] as string[] };
  const input = value as { assessments: { criterionId?: unknown }[] };
  const present = new Set(input.assessments.map((a) => a?.criterionId));
  const missing = requirementOutcomes(contract, evidence)
    .flatMap((r) => r.criteria)
    .filter((c) => !present.has(c.criterionId));
  return {
    value: {
      ...value,
      assessments: [
        ...input.assessments,
        ...missing.map((c) => ({
          criterionId: c.criterionId,
          status: c.status,
          explanation: c.reason,
          evidenceIds: c.evidenceIds,
        })),
      ],
    },
    filledCriterionIds: missing.map((c) => c.criterionId),
  };
}
