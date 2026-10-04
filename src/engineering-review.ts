import type { Contract, Evidence, Review } from './domain';

const dimensions = {
  QUALITY: {
    kinds: ['build', 'lint', 'typecheck', 'format'],
    missing: [
      'Duplication, semantic error handling, naming and complexity are not established by these checks.',
    ],
  },
  ARCHITECTURE: {
    kinds: [],
    missing: [
      'Architectural boundaries, coupling, cohesion and data flow require dedicated analysis; source presence is context only.',
    ],
  },
  SECURITY: {
    kinds: ['security', 'dependency'],
    missing: [
      'Exploitability, authentication/authorization regression, injection, sensitive data and permission bypass require dedicated tests; scanner/advisory matches are not exploit proof.',
    ],
  },
  PERFORMANCE: {
    kinds: ['benchmark'],
    missing: [
      'Scalability, memory bounds and production performance are unverified outside configured measurements.',
    ],
  },
  TESTING: {
    kinds: ['test', 'integration', 'coverage', 'acceptance'],
    missing: [
      'Passing configured cases does not prove comprehensive edge-case coverage or test quality.',
    ],
  },
  MAINTAINABILITY: {
    kinds: ['lint', 'typecheck', 'format', 'test', 'coverage'],
    missing: [
      'Technical debt, separation of concerns, extensibility and testability require contextual human assessment.',
    ],
  },
} as const;
export type EngineeringDimension = keyof typeof dimensions;

/** Server-owned projections preserve objective facts without promoting narrative interpretations. */
export function enrichEngineeringReview(
  contract: Contract,
  evidence: Evidence[],
  review: Review,
  origin: 'AI_ASSESSMENT' | 'DETERMINISTIC_POLICY' = 'AI_ASSESSMENT',
) {
  const known = new Map(evidence.map((e) => [e.id, e]));
  const criterionRequirement = new Map(
    contract.requirements.flatMap((r) =>
      r.criteria.map((c) => [c.id, r.id] as const),
    ),
  );
  const checkCriteria = new Map<string, string[]>();
  for (const requirement of contract.requirements)
    for (const criterion of requirement.criteria)
      if (criterion.verification.type === 'runner')
        checkCriteria.set(criterion.verification.checkId, [
          ...(checkCriteria.get(criterion.verification.checkId) ?? []),
          criterion.id,
        ]);
  const policy = contract.execution.runner;
  const configured = [
    ...(policy?.commands ?? []),
    ...(policy?.cases ?? []).map((c) => ({ id: c.id, kind: 'acceptance' })),
    ...(policy?.benchmarks ?? []).map((c) => ({ id: c.id, kind: 'benchmark' })),
  ];
  const checks = configured.map((check) => {
    const criterionIds = checkCriteria.get(check.id) ?? [];
    const facts = evidence.filter(
      (e) =>
        e.kind === 'execution' &&
        (e.id === 'execution-' + check.id ||
          (!!e.criterionId && criterionIds.includes(e.criterionId))),
    );
    const status = facts.some((e) => e.status === 'FAIL')
      ? 'FAIL'
      : facts.some((e) => e.status === 'PASS')
        ? 'PASS'
        : 'UNVERIFIED';
    const baselineStatus = facts.some((e) => e.baselineStatus === 'FAIL')
      ? 'FAIL'
      : facts.some((e) => e.baselineStatus === 'PASS')
        ? 'PASS'
        : 'UNVERIFIED';
    return {
      checkId: check.id,
      kind: check.kind,
      status,
      baselineStatus,
      evidenceIds: facts.map((e) => e.id),
      delta:
        baselineStatus === 'PASS' && status === 'FAIL'
          ? 'REGRESSION'
          : baselineStatus === 'FAIL' && status === 'PASS'
            ? 'IMPROVEMENT'
            : baselineStatus === 'UNVERIFIED' || status === 'UNVERIFIED'
              ? 'UNVERIFIED'
              : 'UNCHANGED',
    };
  });
  const findingsProvenance = review.findings.map((finding, index) => {
    const cited = finding.evidenceIds
      .map((id) => known.get(id))
      .filter((e): e is Evidence => !!e);
    const relatedRequirementIds = [
      ...new Set(
        cited.flatMap((e) =>
          e.criterionId && criterionRequirement.has(e.criterionId)
            ? [criterionRequirement.get(e.criterionId)!]
            : [],
        ),
      ),
    ].sort();
    return {
      findingIndex: index,
      dimension:
        (
          {
            QUALITY: 'QUALITY',
            'CODE-QUALITY': 'QUALITY',
            ARCHITECTURE: 'ARCHITECTURE',
            SECURITY: 'SECURITY',
            PERFORMANCE: 'PERFORMANCE',
            TESTING: 'TESTING',
            MAINTAINABILITY: 'MAINTAINABILITY',
          } as Record<string, string>
        )[finding.category.trim().toUpperCase()] ?? 'OTHER',
      origin,
      relatedRequirementIds,
      sourcePaths: [
        ...new Set(cited.flatMap((e) => (e.path ? [e.path] : []))),
      ].sort(),
      evidenceIds: cited.map((e) => e.id),
      requirementLinkStatus: relatedRequirementIds.length
        ? 'CITED_CRITERION_EVIDENCE'
        : 'UNVERIFIED',
      verification: 'UNVERIFIED',
    };
  });
  const summaries = Object.entries(dimensions).map(
    ([dimension, definition]) => {
      const observedChecks = checks.filter((check) =>
        (definition.kinds as readonly string[]).includes(check.kind),
      );
      const counts = {
        PASS: observedChecks.filter((c) => c.status === 'PASS').length,
        FAIL: observedChecks.filter((c) => c.status === 'FAIL').length,
        UNVERIFIED: observedChecks.filter((c) => c.status === 'UNVERIFIED')
          .length,
      };
      const contextualEvidenceIds =
        dimension === 'SECURITY'
          ? evidence
              .filter(
                (e) =>
                  e.kind === 'source' &&
                  (e.id === 'dependency-audit' ||
                    e.id.startsWith('dependency-')),
              )
              .map((e) => e.id)
          : ['ARCHITECTURE', 'MAINTAINABILITY'].includes(dimension)
            ? evidence
                .filter((e) => e.kind === 'source' || e.kind === 'diff')
                .map((e) => e.id)
            : [];
      return {
        dimension: dimension as EngineeringDimension,
        status:
          counts.PASS + counts.FAIL > 0
            ? 'CHECK_RESULTS_AVAILABLE'
            : 'UNVERIFIED',
        summary: `Configured checks: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.UNVERIFIED} UNVERIFIED. These outcomes describe only their configured check scope, not an overall ${dimension.toLowerCase()} verdict.`,
        checks: observedChecks,
        counts,
        contextualEvidenceIds,
        missingCapabilities: definition.missing.map((reason) => ({
          status: 'UNVERIFIED',
          reason,
        })),
        findingIndexes: findingsProvenance
          .filter((f) => f.dimension === dimension)
          .map((f) => f.findingIndex),
        assessmentOrigin: origin,
        assessmentVerification: 'UNVERIFIED',
      };
    },
  );
  return {
    findingsProvenance,
    engineeringReview: {
      version: 'judge-engineering-dimensions-v1',
      dimensions: summaries,
    },
  };
}
