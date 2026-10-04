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
const semanticRubric = [
  [
    '25.01',
    'Observable problem',
    'QUALITY',
    'Inspect the authoritative problem and cited participant artifacts; prose cannot prove problem understanding.',
  ],
  [
    '25.02',
    'Observable approach',
    'ARCHITECTURE',
    'Compare described approach with the immutable changed source; reconstruct only observable behavior.',
  ],
  [
    '25.03',
    'Changed components',
    'ARCHITECTURE',
    'Inspect the immutable diff and repository inventory for actual changed components and omitted paths.',
  ],
  [
    '25.04',
    'Root problem',
    'QUALITY',
    'Compare implementation and authoritative cases with the root requirement; a passing subset cannot prove root-cause resolution.',
  ],
  [
    '25.05',
    'Symptom masking',
    'QUALITY',
    'Inspect workaround paths and authoritative negative cases for symptom masking.',
  ],
  [
    '25.06',
    'Unnecessary complexity',
    'MAINTAINABILITY',
    'Inspect algorithms and alternatives; lint results do not measure unnecessary complexity.',
  ],
  [
    '25.07',
    'Duplication',
    'MAINTAINABILITY',
    'Inspect repeated implementations or run a configured duplication analyzer.',
  ],
  [
    '25.08',
    'Architecture fit',
    'ARCHITECTURE',
    'Inspect repository conventions and component boundaries; no architecture analyzer is implied.',
  ],
  [
    '25.09',
    'Tradeoffs',
    'ARCHITECTURE',
    'Inspect cited design choices and alternatives; tradeoff interpretation remains human assessment.',
  ],
  [
    '25.10',
    'Assumptions',
    'QUALITY',
    'Inspect and test each stated assumption; repository prose cannot verify it.',
  ],
  [
    '25.11',
    'Edge cases',
    'TESTING',
    'Inspect configured case coverage and missing boundaries; passing existing cases does not imply missing cases passed.',
  ],
  [
    '25.12',
    'Maintainability',
    'MAINTAINABILITY',
    'Inspect responsibilities, complexity and change cost; check outcomes cover only their own scope.',
  ],
  [
    '25.13',
    'Scalability',
    'PERFORMANCE',
    'Inspect reproducible load and resource measurements at stated scale; absent benchmarks remain unverified.',
  ],
  [
    '25.14',
    'Security risk',
    'SECURITY',
    'Inspect dedicated threat-model tests and advisory relevance; scanner matches do not establish exploitability.',
  ],
  [
    '25.15',
    'Regression',
    'QUALITY',
    'Inspect compatible baseline/head execution outcomes; missing baseline measurements cannot prove no regression.',
  ],
  [
    '25.16',
    'Objective support',
    'TESTING',
    'Inspect citations against configured trusted check scope; arbitrary model claims remain unverified.',
  ],
  [
    '25.18',
    'No private intention claims',
    'QUALITY',
    'Private participant intentions are unknown and are never inferred from code, prose, check outcomes or citations.',
  ],
  [
    '27.01',
    'Maintainability',
    'MAINTAINABILITY',
    'Inspect change cost and responsibilities; lint PASS is not maintainability proof.',
  ],
  [
    '27.02',
    'Separation of concerns',
    'ARCHITECTURE',
    'Inspect module responsibilities and interfaces; typecheck PASS does not prove separation.',
  ],
  [
    '27.03',
    'Duplication',
    'MAINTAINABILITY',
    'Inspect repeated code or dedicated duplication analysis.',
  ],
  [
    '27.04',
    'Error handling',
    'QUALITY',
    'Inspect failure paths and dedicated error-case executions.',
  ],
  [
    '27.05',
    'Naming',
    'QUALITY',
    'Inspect naming against repository conventions; no naming analyzer is configured.',
  ],
  [
    '27.06',
    'Structure',
    'ARCHITECTURE',
    'Inspect changed file organization and dependency boundaries.',
  ],
  [
    '27.07',
    'Complexity',
    'MAINTAINABILITY',
    'Inspect a dedicated complexity measure and relevant source.',
  ],
  [
    '27.08',
    'API design',
    'ARCHITECTURE',
    'Inspect API inventory, compatibility tests and intended call sites.',
  ],
  [
    '27.09',
    'Architectural consistency',
    'ARCHITECTURE',
    'Inspect repository conventions and layer interactions.',
  ],
  [
    '27.10',
    'Technical debt',
    'MAINTAINABILITY',
    'Inspect concrete debt introduced or removed and future change costs.',
  ],
  [
    '27.11',
    'Testability',
    'TESTING',
    'Inspect seams and deterministic test isolation; test PASS does not prove testability.',
  ],
  [
    '28.01',
    'Hardcoded secrets',
    'SECURITY',
    'Inspect redacted secret-scan results and credential handling; never reproduce secret values.',
  ],
  [
    '28.02',
    'Input validation',
    'SECURITY',
    'Inspect boundary validation and dedicated invalid-input tests.',
  ],
  [
    '28.03',
    'Authentication regression',
    'SECURITY',
    'Inspect authentication-specific baseline/head negative tests.',
  ],
  [
    '28.04',
    'Authorization regression',
    'SECURITY',
    'Inspect role/ownership denial cases on baseline and head.',
  ],
  [
    '28.05',
    'Injection',
    'SECURITY',
    'Inspect dedicated injection threat-model cases and tainted data paths.',
  ],
  [
    '28.06',
    'Sensitive data',
    'SECURITY',
    'Inspect redaction, storage and disclosure boundaries without exposing sensitive values.',
  ],
  [
    '28.07',
    'Dependencies',
    'SECURITY',
    'Inspect pinned inventory and dated advisory metadata; matching metadata alone is not exploitability proof.',
  ],
  [
    '28.08',
    'Command execution',
    'SECURITY',
    'Inspect subprocess boundaries and dedicated command-injection tests.',
  ],
  [
    '28.09',
    'File handling',
    'SECURITY',
    'Inspect path traversal, symlink and file-permission cases.',
  ],
  [
    '28.10',
    'Permission bypass',
    'SECURITY',
    'Inspect explicit deny-path and privilege-boundary executions.',
  ],
  [
    '28.11',
    'Network behavior',
    'SECURITY',
    'Inspect configured isolation and network-denial measurements.',
  ],
  [
    '29.01',
    'Consistency',
    'ARCHITECTURE',
    'Inspect conventions across changed and existing components.',
  ],
  [
    '29.02',
    'Boundaries',
    'ARCHITECTURE',
    'Inspect dependencies and ownership across module boundaries.',
  ],
  [
    '29.03',
    'Coupling',
    'ARCHITECTURE',
    'Inspect dependency relationships; no coupling analyzer is configured.',
  ],
  [
    '29.04',
    'Cohesion',
    'ARCHITECTURE',
    'Inspect how each component groups related responsibilities.',
  ],
  [
    '29.05',
    'Data flow',
    'ARCHITECTURE',
    'Trace validated input, transformations and storage/output boundaries.',
  ],
  [
    '29.06',
    'Scalability',
    'PERFORMANCE',
    'Inspect bounded resource measurements and reproducible load tests.',
  ],
  [
    '29.07',
    'Extensibility',
    'ARCHITECTURE',
    'Inspect extension points and concrete anticipated changes.',
  ],
  [
    '29.08',
    'Unnecessary rewrite',
    'ARCHITECTURE',
    'Inspect the diff against requirement scope and existing components.',
  ],
  [
    '29.09',
    'Layer bypass',
    'ARCHITECTURE',
    'Inspect direct dependencies and calls that bypass established interfaces.',
  ],
  [
    '29.10',
    'Responsibility placement',
    'ARCHITECTURE',
    'Inspect which component owns each changed responsibility.',
  ],
] as const;

// Routing identifies relevant persisted interpretation, never semantic correctness.
const facetTopics: Record<string, RegExp> = {
  '25.03': /component|module|file|changed|diff/i,
  '25.05': /symptom|mask|workaround|root.cause/i,
  '25.06': /complex|unnecessary|over.engineer/i,
  '25.07': /duplicat|repeated|copy.past/i,
  '25.11': /edge.case|boundary|invalid|empty|null|exhaust|negative.case/i,
  '25.13': /scalab|throughput|load|memory|resource|latency/i,
  '25.14': /security|vulnerab|attack|auth|injection|secret|permission/i,
  '25.15': /regress|baseline|preserv|existing.behavio/i,
  '25.16': /criterion|criteria|check|test|execution|objective/i,
  '27.02': /separation|concern|responsibilit|boundary/i,
  '27.03': /duplicat|repeated|copy.past/i,
  '27.04': /error.handl|exception|failure.path|throw|catch/i,
  '27.05': /naming|name.convention|identifier/i,
  '27.06': /structure|organization|module|file/i,
  '27.07': /complex|cyclomatic|nested/i,
  '27.08': /api|interface|compatib|call.site/i,
  '27.09': /architectur|convention|consistent|consistency|layer/i,
  '27.10': /technical.debt|debt|future.change|change.cost/i,
  '27.11': /testab|test.seam|test.isolation|mock|deterministic.test/i,
  '28.01': /hardcod|secret|credential|api.key/i,
  '28.02': /validat|invalid.input|input.boundary/i,
  '28.03': /authentication|authenticat|login|identity/i,
  '28.04': /authorization|authoriz|role|ownership/i,
  '28.05': /injection|taint|sql|xss/i,
  '28.06': /sensitive|redact|disclos|personal.data/i,
  '28.07': /dependenc|advisory|package|vulnerable.version/i,
  '28.08': /command|subprocess|shell|\bexec(?:Sync|File)?\b/i,
  '28.09': /file.handling|symlink|traversal|file.permission|path.validat/i,
  '28.10': /permission|privilege|bypass|deny.path/i,
  '28.11': /network|egress|socket|outbound/i,
  '29.01': /consistent|consistency|convention/i,
  '29.02': /boundary|boundaries|ownership|module/i,
  '29.03': /coupl|dependenc/i,
  '29.04': /cohesion|related.responsibilit/i,
  '29.05': /data.flow|transform|input|output|storage/i,
  '29.06': /scalab|load|throughput|resource|memory/i,
  '29.07': /extensib|extension|future.change/i,
  '29.08': /rewrite|scope|unnecessary/i,
  '29.09': /layer|bypass|direct.call/i,
  '29.10': /responsibilit|component.own|placement/i,
};
const facetFields: Record<string, readonly string[]> = {
  '25.01': ['problem_understanding'],
  '25.02': ['approach_summary', 'solution_design'],
  '25.04': ['correctness'],
  '25.08': ['architecture_fit'],
  '25.09': ['tradeoffs'],
  '25.10': ['unverified_assumptions'],
  '25.12': ['maintainability'],
  '27.01': ['maintainability'],
};

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
  const approach = review.solution_approach;
  const contextualEntries = [
    ...(
      [
        'problem_understanding',
        'approach_summary',
        'solution_design',
        'correctness',
        'maintainability',
        'architecture_fit',
      ] as const
    ).map((field) => ({
      field,
      observationPath: `solution_approach.${field}`,
      findingIndex: null as number | null,
      text: approach[field].text,
      evidenceIds: approach[field].evidenceIds,
    })),
    ...(
      [
        'strengths',
        'weaknesses',
        'tradeoffs',
        'unverified_assumptions',
      ] as const
    ).flatMap((field) =>
      approach[field].map((observation, index) => ({
        field,
        observationPath: `solution_approach.${field}[${index}]`,
        findingIndex: null as number | null,
        text: observation.text,
        evidenceIds: observation.evidenceIds,
      })),
    ),
    ...review.findings.map((finding, findingIndex) => ({
      field: 'finding',
      observationPath: null as string | null,
      findingIndex,
      text: finding.claim,
      evidenceIds: finding.evidenceIds,
    })),
  ];
  const contextualForFacet = (id: string) => {
    if (id === '25.18' || origin !== 'AI_ASSESSMENT') return [];
    return contextualEntries
      .filter(
        (entry) =>
          entry.text.trim().length >= 20 &&
          entry.evidenceIds.length > 0 &&
          entry.evidenceIds.every((evidenceId) => known.has(evidenceId)) &&
          ((facetFields[id] ?? []).includes(entry.field) ||
            facetTopics[id]?.test(entry.text)),
      )
      .map((entry) => ({
        observationPath: entry.observationPath,
        findingIndex: entry.findingIndex,
        text: entry.text,
        status: 'UNVERIFIED',
        origin,
        relevanceBasis: (facetFields[id] ?? []).includes(entry.field)
          ? 'SCOPED_APPROACH_FIELD'
          : 'EXPLICIT_TOPIC_MATCH',
        // IDs and types come from frozen server evidence, never narrative claims.
        evidence: entry.evidenceIds.map((evidenceId) => {
          const item = known.get(evidenceId)!;
          const requirementId = item.criterionId
            ? criterionRequirement.get(item.criterionId)
            : undefined;
          const typedCheck = checks.find((check) =>
            check.evidenceIds.includes(evidenceId),
          );
          return {
            evidenceId,
            kind: item.kind,
            status: item.status,
            path: item.path ?? null,
            criterionId: item.criterionId ?? null,
            requirementId: requirementId ?? null,
            checkId: typedCheck?.checkId ?? null,
            checkKind: typedCheck?.kind ?? null,
            scope: typedCheck ? 'CONFIGURED_CHECK_ONLY' : 'CITED_CONTEXT_ONLY',
          };
        }),
      }));
  };

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
      const resultEvidenceIds = [
        ...new Set(
          observedChecks
            .filter((check) => check.status !== 'UNVERIFIED')
            .flatMap((check) => check.evidenceIds),
        ),
      ];
      const regressions = observedChecks.filter(
        (check) => check.delta === 'REGRESSION',
      );
      const failures = observedChecks.filter(
        (check) => check.status === 'FAIL',
      );
      const unsupportedChecks = observedChecks.filter(
        (check) => check.status === 'UNVERIFIED',
      );
      const assessmentChecks = regressions.length
        ? regressions
        : failures.length
          ? failures
          : unsupportedChecks;
      const assessmentText = regressions.length
        ? 'Configured check regression requires inspecting baseline/head evidence before judging this dimension.'
        : failures.length
          ? 'Configured check failures require human inspection; they do not establish broader defects outside check scope.'
          : unsupportedChecks.length
            ? 'Configured checks lack verified results; execute or inspect them before making a dimension judgment.'
            : 'No deterministic adverse-check or missing-check assessment is supported; broader engineering interpretation remains unverified.';
      return {
        dimension: dimension as EngineeringDimension,
        status:
          counts.PASS + counts.FAIL > 0
            ? 'CHECK_RESULTS_AVAILABLE'
            : 'UNVERIFIED',
        supportMatrix: {
          facts: {
            status: resultEvidenceIds.length ? 'SUPPORTED_FACT' : 'UNVERIFIED',
            scope: 'configured-check-outcomes-only',
            evidenceIds: resultEvidenceIds,
          },
          engineeringAssessment: {
            status: assessmentChecks.length
              ? 'SUPPORTED_ENGINEERING_ASSESSMENT'
              : 'UNVERIFIED',
            origin: 'SERVER_EVIDENCE_COVERAGE_ASSESSMENT',
            text: assessmentText,
            checkIds: assessmentChecks.map((check) => check.checkId),
            evidenceIds: [
              ...new Set(
                assessmentChecks.flatMap((check) => check.evidenceIds),
              ),
            ],
            requiresHumanInspection: true,
          },
          contextualAi: {
            status: 'UNVERIFIED',
            origin,
            findingIndexes: findingsProvenance
              .filter((f) => f.dimension === dimension)
              .map((f) => f.findingIndex),
            reason:
              'Citation validity alone cannot establish arbitrary model prose as an engineering fact.',
          },
        },
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
      version: 'judge-engineering-dimensions-v2',
      dimensions: summaries,
      rubric: semanticRubric.map(([id, label, dimension, inspectReason]) => {
        const parent = summaries.find(
          (summary) => summary.dimension === dimension,
        )!;
        const supportingChecks =
          id === '25.15'
            ? checks.filter(
                (check) =>
                  check.delta === 'REGRESSION' || check.delta === 'IMPROVEMENT',
              )
            : id === '25.16'
              ? checks.filter((check) => check.status !== 'UNVERIFIED')
              : [];
        const evidenceIds = [
          ...new Set(supportingChecks.flatMap((check) => check.evidenceIds)),
        ];
        const contextualAnalysis = contextualForFacet(id);
        return {
          id,
          label,
          dimension,
          status: evidenceIds.length ? 'SUPPORTED_FACT' : 'UNVERIFIED',
          scope:
            id === '25.15'
              ? 'configured-baseline-head-check-deltas-only'
              : id === '25.16'
                ? 'configured-check-outcomes-only'
                : 'semantic-facet',
          evidenceIds,
          inspectReason,
          contextualAnalysis,
          analysisCoverage: contextualAnalysis.length
            ? 'CONTEXTUAL_ANALYSIS_AVAILABLE'
            : 'MISSING_MEANINGFUL_ANALYSIS',
          needsReview: true,
          missingAnalysisReason: contextualAnalysis.length
            ? null
            : id === '25.18'
              ? 'Private intention is unknown and cannot be inferred.'
              : 'No sufficiently scoped persisted observation or finding with known citations addresses this facet.',
          requiresHumanInspection: true,
          aiNarrativeStatus: 'UNVERIFIED',
          parentFactStatus: parent.supportMatrix.facts.status,
        };
      }),
    },
  };
}
