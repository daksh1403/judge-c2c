import { z } from 'zod';
import {
  canonical,
  contractSchema,
  digest,
  pathSchema,
  type Evidence,
  type Contract,
} from './domain';
import type { Env } from './env';
import { redact } from './security';

const candidateInput = z
  .object({
    category: z.string().min(1).max(80),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(20).max(2000),
    paths: z.array(z.string().min(1).max(240)).min(1).max(20),
    evidenceIds: z.array(z.string().min(1).max(100)).max(50),
    criterionIds: z.array(z.string().min(1).max(80)).max(30),
  })
  .strict();

const reviewInput = z
  .object({
    decision: z.enum(['RECOGNIZED', 'REJECTED']),
    reason: z.string().trim().min(20).max(2000),
    requestId: z.string().uuid(),
    expectedPreviousSequence: z.number().int().nonnegative().nullable(),
  })
  .strict();
const contextSchema = z.object({
  files: z.array(z.object({ filename: z.string().min(1) })),
});
const evidenceSchema = z.array(
  z.object({
    id: z.string().min(1).max(100),
    kind: z.enum(['diff', 'source', 'policy', 'execution']),
    claim: z.string(),
    status: z.enum(['PASS', 'FAIL', 'UNVERIFIED']),
    baselineStatus: z.enum(['PASS', 'FAIL', 'UNVERIFIED']).optional(),
    criterionId: z.string().optional(),
    path: z.string().optional(),
  }),
);

type EvaluationRow = {
  id: string;
  state: string;
  repository_id: number;
  pr_number: number;
  head_sha: string;
  contract_snapshot: string | null;
  context: string | null;
  evidence: string | null;
};

type CandidateRow = {
  id: string;
  run_id: string;
  actor: string;
  category: string;
  title: string;
  description: string;
  paths: string;
  evidence_ids: string;
  criterion_ids: string;
  verification_status: 'VERIFIED' | 'UNVERIFIED';
  created_at: string;
};

type DecisionRow = {
  sequence: number;
  id: string;
  candidate_id: string;
  run_id: string;
  decision: 'RECOGNIZED' | 'REJECTED';
  reason: string;
  actor: string;
  created_at: string;
};

export class AdditionalContributionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

function parseJson<T>(text: string | null, label: string): T {
  if (text === null) throw new AdditionalContributionError(label, 409);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AdditionalContributionError(label, 409);
  }
}

function unique(values: string[]) {
  return new Set(values).size === values.length;
}

function verificationStatus(
  input: z.infer<typeof candidateInput>,
  contract: Contract,
  evidence: Evidence[],
): 'VERIFIED' | 'UNVERIFIED' {
  if (input.criterionIds.length === 0) return 'UNVERIFIED';
  const selected = new Set(input.evidenceIds);
  const optionalCriteria = contract.requirements
    .filter((requirement) => !requirement.mandatory)
    .flatMap((requirement) => requirement.criteria);
  const criteria = input.criterionIds.map((criterionId) => {
    const criterion = optionalCriteria.find((item) => item.id === criterionId);
    if (!criterion)
      throw new AdditionalContributionError(
        'Criterion must belong to a frozen optional requirement',
        400,
      );
    return criterion;
  });
  for (const criterion of criteria) {
    const criterionId = criterion.id;
    const expectedKind =
      criterion.kind === 'functional'
        ? 'execution'
        : criterion.verification.type === 'human'
          ? 'policy'
          : 'source';
    const authoritative = evidence.filter(
      (item) => item.criterionId === criterionId && item.kind === expectedKind,
    );
    if (
      authoritative.some(
        (item) =>
          item.status === 'FAIL' ||
          item.status === 'UNVERIFIED' ||
          item.baselineStatus === 'UNVERIFIED',
      )
    )
      throw new AdditionalContributionError(
        `Conflicting objective evidence for criterion ${criterionId}`,
        409,
      );
    const passing = authoritative.find((item) => {
      if (
        item.status !== 'PASS' ||
        item.baselineStatus !== 'FAIL' ||
        !selected.has(item.id)
      )
        return false;
      if (criterion.verification.type !== 'file_contains') return true;
      return (
        item.path === criterion.verification.path &&
        input.paths.includes(criterion.verification.path)
      );
    });
    if (!passing) return 'UNVERIFIED';
  }
  return 'VERIFIED';
}

function serializeCandidate(row: CandidateRow, decision: DecisionRow | null) {
  return {
    id: row.id,
    runId: row.run_id,
    actor: row.actor,
    category: row.category,
    title: row.title,
    description: row.description,
    paths: JSON.parse(row.paths) as string[],
    evidenceIds: JSON.parse(row.evidence_ids) as string[],
    criterionIds: JSON.parse(row.criterion_ids) as string[],
    verificationStatus: row.verification_status,
    createdAt: row.created_at,
    latestDecision: decision
      ? {
          sequence: decision.sequence,
          id: decision.id,
          candidateId: decision.candidate_id,
          runId: decision.run_id,
          decision: decision.decision,
          reason: decision.reason,
          actor: decision.actor,
          createdAt: decision.created_at,
        }
      : null,
  };
}

async function createCandidateRecord(
  env: Env,
  runId: string,
  actor: string,
  raw: unknown,
  stableId?: string,
) {
  if (stableId) {
    const [existing] = await listCandidates(env, runId, stableId);
    if (existing) return existing;
  }
  const parsed = candidateInput.safeParse(raw);
  if (!parsed.success || !actor.trim() || actor.length > 160)
    throw new AdditionalContributionError('Invalid candidate', 400);
  const input = {
    ...parsed.data,
    title: redact(parsed.data.title).trim(),
    description: redact(parsed.data.description).trim(),
  };
  if (!candidateInput.safeParse(input).success)
    throw new AdditionalContributionError(
      'Invalid redacted candidate text',
      400,
    );
  if (
    !unique(input.paths) ||
    !unique(input.evidenceIds) ||
    !unique(input.criterionIds)
  )
    throw new AdditionalContributionError(
      'Duplicate candidate identifiers',
      400,
    );

  const run = await env.DB.prepare(
    'SELECT id,state,repository_id,pr_number,head_sha,contract_snapshot,context,evidence FROM evaluations WHERE id=?',
  )
    .bind(runId)
    .first<EvaluationRow>();
  if (!run) throw new AdditionalContributionError('Run not found', 404);
  if (run.state !== 'COMPLETED')
    throw new AdditionalContributionError('Run is not complete', 409);
  const contractResult = contractSchema.safeParse(
    parseJson<unknown>(run.contract_snapshot, 'Invalid frozen contract'),
  );
  const contextResult = contextSchema.safeParse(
    parseJson<unknown>(run.context, 'Invalid frozen context'),
  );
  const evidenceResult = evidenceSchema.safeParse(
    parseJson<unknown>(run.evidence, 'Invalid frozen evidence'),
  );
  if (
    !contractResult.success ||
    !contextResult.success ||
    !evidenceResult.success
  )
    throw new AdditionalContributionError('Malformed frozen run snapshot', 409);
  const contract: Contract = contractResult.data;
  const context = contextResult.data;
  const evidence: Evidence[] = evidenceResult.data;
  if (new Set(evidence.map((item) => item.id)).size !== evidence.length)
    throw new AdditionalContributionError('Duplicate frozen evidence IDs', 409);
  if (
    !contract.additionalCategories.includes(input.category) ||
    input.paths.some(
      (path) =>
        !pathSchema.safeParse(path).success ||
        !context.files.some((file) => file.filename === path),
    )
  )
    throw new AdditionalContributionError(
      'Category or path is outside the frozen run',
      400,
    );
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  if (input.evidenceIds.some((id) => !evidenceById.has(id)))
    throw new AdditionalContributionError('Unknown evidence citation', 400);
  const status =
    run.head_sha === contract.baseline
      ? 'UNVERIFIED'
      : verificationStatus(input, contract, evidence);
  const id = stableId ?? crypto.randomUUID();
  const statements = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO additional_contributions(id,run_id,actor,category,title,description,paths,evidence_ids,criterion_ids,verification_status)
       SELECT ?,id,?,?,?,?,?,?,?,? FROM evaluations WHERE id=? AND state='COMPLETED'
         AND EXISTS(SELECT 1 FROM json_each(contract_snapshot,'$.additionalCategories') WHERE value=?)
         AND NOT EXISTS(SELECT 1 FROM additional_contributions WHERE id=?)
         AND (SELECT count(*) FROM additional_contributions WHERE run_id=?)<20`,
    ).bind(
      id,
      actor,
      input.category,
      input.title,
      input.description,
      canonical(input.paths),
      canonical(input.evidenceIds),
      canonical(input.criterionIds),
      status,
      runId,
      input.category,
      id,
      runId,
    ),
    env.DB.prepare(
      `INSERT INTO audit(action,entity,actor,changes)
       SELECT 'additional_contribution.created',?,?,? WHERE changes()=1`,
    ).bind(
      id,
      actor,
      canonical({
        runId,
        category: input.category,
        verificationStatus: status,
      }),
    ),
  ]);
  if ((!statements[0] || statements[0].meta.changes !== 1) && stableId) {
    const [existing] = await listCandidates(env, runId, stableId);
    if (existing) return existing;
  }
  if (!statements[0] || statements[0].meta.changes !== 1)
    throw new AdditionalContributionError(
      'Candidate creation lost a race',
      409,
    );
  const [candidate] = await listCandidates(env, runId, id);
  return candidate!;
}

export async function createCandidate(
  env: Env,
  runId: string,
  actor: string,
  raw: unknown,
): Promise<{ status: number; body: unknown }> {
  try {
    return {
      status: 201,
      body: await createCandidateRecord(env, runId, actor, raw),
    };
  } catch (error) {
    if (error instanceof AdditionalContributionError)
      return { status: error.status, body: { error: error.message } };
    if (error instanceof Error && error.message.includes('limit reached'))
      return {
        status: 409,
        body: { error: 'Run candidate limit reached' },
      };
    throw error;
  }
}

function decisionOutput(row: DecisionRow) {
  return {
    sequence: row.sequence,
    id: row.id,
    candidateId: row.candidate_id,
    runId: row.run_id,
    decision: row.decision,
    reason: row.reason,
    actor: row.actor,
    createdAt: row.created_at,
  };
}

async function reviewCandidateRecord(
  env: Env,
  id: string,
  actor: string,
  raw: unknown,
) {
  const parsed = reviewInput.safeParse(raw);
  if (!parsed.success || !actor.trim() || actor.length > 160)
    throw new AdditionalContributionError('Invalid decision', 400);
  const input = parsed.data;
  const safeInput = { ...input, reason: redact(input.reason).trim() };
  if (!reviewInput.safeParse(safeInput).success)
    throw new AdditionalContributionError(
      'Invalid redacted decision reason',
      400,
    );
  const requestHash = await digest(
    canonical({ candidateId: id, actor, ...safeInput }),
  );
  const replay = await env.DB.prepare(
    'SELECT * FROM additional_contribution_decisions WHERE request_id=?',
  )
    .bind(input.requestId)
    .first<DecisionRow & { request_hash: string }>();
  if (replay) {
    if (replay.request_hash !== requestHash)
      throw new AdditionalContributionError('Idempotency key reused', 409);
    return decisionOutput(replay);
  }
  const candidate = await env.DB.prepare(
    `SELECT c.*,e.evidence,e.state FROM additional_contributions c
     JOIN evaluations e ON e.id=c.run_id WHERE c.id=?`,
  )
    .bind(id)
    .first<CandidateRow & { evidence: string | null; state: string }>();
  if (!candidate)
    throw new AdditionalContributionError('Candidate not found', 404);
  const evidence = parseJson<Evidence[]>(
    candidate.evidence,
    'Invalid frozen evidence',
  );
  const cited = new Set(JSON.parse(candidate.evidence_ids) as string[]);
  const evidenceSnapshot = canonical(
    evidence.filter((item) => cited.has(item.id)),
  );
  const decisionId = crypto.randomUUID();
  const isRecognition = safeInput.decision === 'RECOGNIZED';
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO additional_contribution_decisions(id,candidate_id,run_id,request_id,request_hash,decision,reason,actor,evidence_snapshot)
       SELECT ?,c.id,c.run_id,?,?,?,?,?,? FROM additional_contributions c
       JOIN evaluations e ON e.id=c.run_id
       JOIN submissions s ON s.repository_id=e.repository_id AND s.pr_number=e.pr_number
       WHERE c.id=? AND c.run_id=?
         AND ((? IS NULL AND NOT EXISTS(SELECT 1 FROM additional_contribution_decisions d WHERE d.candidate_id=c.id))
           OR (? IS NOT NULL AND (SELECT max(sequence) FROM additional_contribution_decisions d WHERE d.candidate_id=c.id)=?))
         AND (?=0 OR (c.verification_status='VERIFIED' AND e.state='COMPLETED'
           AND e.id=s.latest_run_id AND e.head_sha=s.head_sha AND s.closed=0 AND s.status='VALID'
           AND e.head_sha<>json_extract(e.contract_snapshot,'$.baseline')
           AND EXISTS(SELECT 1 FROM hackathons h WHERE h.id='initial' AND h.status='ACTIVE')
           AND coalesce(json_extract(e.assignment_snapshot,'$.team_id'),json_extract(e.assignment_snapshot,'$.teamId'))=s.team_id
           AND EXISTS(SELECT 1 FROM teams t JOIN team_repositories tr ON tr.team_id=t.id AND tr.repository_id=e.repository_id AND tr.active=1 JOIN github_repositories r ON r.id=tr.repository_id AND r.accessible=1 WHERE t.id=s.team_id AND t.status='ACTIVE')
           AND (json_extract(e.assignment_snapshot,'$.resolution_snapshot') IS NULL OR (
             EXISTS(SELECT 1 FROM json_each(json_extract(json_extract(e.assignment_snapshot,'$.resolution_snapshot'),'$.assignmentIds')))
             AND NOT EXISTS(SELECT 1 FROM json_each(json_extract(json_extract(e.assignment_snapshot,'$.resolution_snapshot'),'$.assignmentIds')) j
               LEFT JOIN issue_assignments a ON a.id=j.value
               LEFT JOIN github_issues i ON i.repository_id=a.repository_id AND i.number=a.issue_number
               WHERE a.id IS NULL OR a.status<>'ACTIVE' OR (a.expires_at IS NOT NULL AND datetime(a.expires_at)<=CURRENT_TIMESTAMP)
                 OR i.review_status<>'APPROVED' OR i.github_state<>'open' OR i.official<>1)
             AND (json_extract(json_extract(e.assignment_snapshot,'$.resolution_snapshot'),'$.override') IS NOT NULL
               OR EXISTS(SELECT 1 FROM team_members m WHERE m.team_id=s.team_id AND m.github_id=json_extract(json_extract(e.assignment_snapshot,'$.resolution_snapshot'),'$.githubAuthor.id') AND m.active=1))
           ))
           AND NOT EXISTS(SELECT 1 FROM json_each(coalesce(e.evidence,'[]')) j WHERE json_extract(j.value,'$.kind')='policy' AND json_extract(j.value,'$.status')='FAIL')
           AND NOT EXISTS(SELECT 1 FROM json_each(coalesce(e.evidence,'[]')) j WHERE json_extract(j.value,'$.status')='FAIL' AND json_extract(j.value,'$.baselineStatus')='PASS')))
         AND NOT EXISTS(SELECT 1 FROM additional_contribution_decisions d WHERE d.request_id=?)`,
    ).bind(
      decisionId,
      safeInput.requestId,
      requestHash,
      safeInput.decision,
      safeInput.reason,
      actor,
      evidenceSnapshot,
      id,
      candidate.run_id,
      safeInput.expectedPreviousSequence,
      safeInput.expectedPreviousSequence,
      safeInput.expectedPreviousSequence,
      Number(isRecognition),
      safeInput.requestId,
    ),
    env.DB.prepare(
      `INSERT INTO audit(action,entity,actor,changes)
       SELECT ?,?,?,? WHERE changes()=1`,
    ).bind(
      isRecognition
        ? 'additional_contribution.recognized'
        : 'additional_contribution.rejected',
      id,
      actor,
      canonical({
        decision: safeInput.decision,
        requestId: safeInput.requestId,
      }),
    ),
  ]);
  if (!results[0] || results[0].meta.changes !== 1)
    throw new AdditionalContributionError(
      'Candidate is stale or not eligible for this decision',
      409,
    );
  const result = await env.DB.prepare(
    'SELECT * FROM additional_contribution_decisions WHERE id=?',
  )
    .bind(decisionId)
    .first<DecisionRow>();
  return decisionOutput(result!);
}

export async function reviewCandidate(
  env: Env,
  id: string,
  actor: string,
  raw: unknown,
): Promise<{ status: number; body: unknown }> {
  try {
    return {
      status: 200,
      body: await reviewCandidateRecord(env, id, actor, raw),
    };
  } catch (error) {
    if (error instanceof AdditionalContributionError)
      return { status: error.status, body: { error: error.message } };
    throw error;
  }
}

export async function listCandidates(env: Env, runId: string, onlyId?: string) {
  const rows = await env.DB.prepare(
    `SELECT c.*,d.sequence AS decision_sequence,d.id AS decision_id,d.candidate_id AS decision_candidate_id,
       d.run_id AS decision_run_id,d.decision AS decision_value,d.reason AS decision_reason,
       d.actor AS decision_actor,d.created_at AS decision_created_at
     FROM additional_contributions c
     LEFT JOIN additional_contribution_decisions d ON d.sequence=(
       SELECT max(newer.sequence) FROM additional_contribution_decisions newer WHERE newer.candidate_id=c.id)
     WHERE c.run_id=? AND (? IS NULL OR c.id=?) ORDER BY c.created_at,c.id`,
  )
    .bind(runId, onlyId ?? null, onlyId ?? null)
    .all<
      CandidateRow & {
        decision_sequence: number | null;
        decision_id: string | null;
        decision_candidate_id: string | null;
        decision_run_id: string | null;
        decision_value: DecisionRow['decision'] | null;
        decision_reason: string | null;
        decision_actor: string | null;
        decision_created_at: string | null;
      }
    >();
  return rows.results.map((row) => {
    const decision: DecisionRow | null = row.decision_sequence
      ? {
          sequence: row.decision_sequence,
          id: row.decision_id!,
          candidate_id: row.decision_candidate_id!,
          run_id: row.decision_run_id!,
          decision: row.decision_value!,
          reason: row.decision_reason!,
          actor: row.decision_actor!,
          created_at: row.decision_created_at!,
        }
      : null;
    return serializeCandidate(row, decision);
  });
}

/** Bounded suggestions only. Recognition, novelty attribution and credit stay with organizers. */
export async function discoverAdditionalContributions(env: Env, runId: string) {
  const run = await env.DB.prepare(
    'SELECT id,state,repository_id,pr_number,head_sha,contract_snapshot,context,evidence FROM evaluations WHERE id=?',
  )
    .bind(runId)
    .first<EvaluationRow>();
  if (!run || run.state !== 'COMPLETED')
    return { status: 'UNAVAILABLE', candidateIds: [] as string[] };
  const contract = contractSchema.safeParse(
    parseJson<unknown>(run.contract_snapshot, 'Invalid frozen contract'),
  );
  const context = z
    .object({
      files: z
        .array(
          z.object({
            filename: pathSchema,
            status: z.string().optional(),
            additions: z.number().nonnegative().optional(),
          }),
        )
        .max(1000),
    })
    .safeParse(parseJson<unknown>(run.context, 'Invalid frozen context'));
  const facts = evidenceSchema.safeParse(
    parseJson<unknown>(run.evidence, 'Invalid frozen evidence'),
  );
  if (
    !contract.success ||
    !context.success ||
    !facts.success ||
    !unique(facts.data.map((e) => e.id))
  )
    return { status: 'INVALID_SNAPSHOT', candidateIds: [] as string[] };
  const c = contract.data,
    evidence: Evidence[] = facts.data;
  if (
    evidence.some(
      (e) =>
        (e.kind === 'policy' && e.status === 'FAIL') ||
        (e.baselineStatus === 'PASS' && e.status === 'FAIL'),
    )
  )
    return {
      status: 'BLOCKED_POLICY_OR_REGRESSION',
      candidateIds: [] as string[],
    };
  if (run.head_sha === c.baseline)
    return { status: 'NO_SUGGESTIONS', candidateIds: [] as string[] };
  const categories = c.additionalCategories;
  const category = (options: string[]) =>
    categories.find((value) => options.includes(value.trim().toLowerCase()));
  const changed = context.data.files.filter(
    (f) =>
      ['added', 'modified', 'renamed'].includes(f.status ?? '') &&
      !c.forbiddenPaths.some(
        (p) => f.filename === p || f.filename.startsWith(p + '/'),
      ),
  );
  const diff = evidence
    .filter((e) => e.kind === 'diff' && e.status === 'PASS')
    .map((e) => e.id);
  if (!changed.length || !diff.length || !categories.length)
    return { status: 'NO_SUGGESTIONS', candidateIds: [] as string[] };
  const inputs: z.infer<typeof candidateInput>[] = [];
  for (const requirement of c.requirements.filter((r) => !r.mandatory))
    for (const criterion of requirement.criteria) {
      if (
        criterion.kind !== 'functional' ||
        criterion.verification.type !== 'runner'
      )
        continue;
      const authoritative = evidence.filter(
        (e) => e.kind === 'execution' && e.criterionId === criterion.id,
      );
      if (
        !authoritative.length ||
        authoritative.some(
          (e) => e.status !== 'PASS' || e.baselineStatus !== 'FAIL',
        )
      )
        continue;
      const checkId = criterion.verification.checkId;
      const benchmark = c.execution.runner?.benchmarks?.some(
        (b) => b.id === checkId,
      );
      const selectedCategory = category(
        benchmark
          ? ['performance']
          : ['functionality', 'features', 'feature', 'testing'],
      );
      if (!selectedCategory) continue;
      inputs.push({
        category: selectedCategory,
        title: 'Optional functional improvement: ' + criterion.id,
        description:
          'Server suggestion from a frozen optional functional criterion improving from baseline FAIL to head PASS in trusted execution. Changed paths are diff provenance, not proof of authorship or causal attribution. An organizer must assess novelty, attribution and recognition; no credit is automatic.',
        paths: changed.slice(0, 20).map((f) => f.filename),
        evidenceIds: [
          ...new Set([...diff, ...authoritative.map((e) => e.id)]),
        ].slice(0, 50),
        criterionIds: [criterion.id],
      });
    }
  const requiredPaths = new Set(
    c.requirements
      .filter((r) => r.mandatory)
      .flatMap((r) =>
        r.criteria.flatMap((k) =>
          k.verification.type === 'file_contains' ? [k.verification.path] : [],
        ),
      ),
  );
  for (const file of changed.filter(
    (f) =>
      f.status === 'added' &&
      (f.additions ?? 0) > 0 &&
      !requiredPaths.has(f.filename),
  )) {
    const selectedCategory = /\.(md|mdx|rst|txt)$/i.test(file.filename)
      ? category(['documentation', 'docs'])
      : /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|(?:\.|-)(?:test|spec)\.[cm]?[jt]sx?$/i.test(
            file.filename,
          )
        ? category(['testing', 'tests'])
        : undefined;
    if (!selectedCategory) continue;
    inputs.push({
      category: selectedCategory,
      title: 'Inspect additional ' + selectedCategory + ' path',
      description:
        'Server suggestion: a newly added path appears in the immutable baseline-to-head diff. Its content, usefulness, novelty, functional behavior and participant attribution remain unverified. Required-path assertions are excluded from this discovery rule. Human review is required and no credit is automatic.',
      paths: [file.filename],
      evidenceIds: [
        ...new Set([
          ...diff,
          ...evidence
            .filter((e) => e.kind === 'source' && e.path === file.filename)
            .map((e) => e.id),
        ]),
      ].slice(0, 50),
      criterionIds: [],
    });
  }
  const candidateIds: string[] = [];
  for (const input of inputs.slice(0, 5)) {
    const id =
      'discovery-' +
      (
        await digest(
          canonical({
            version: 'additional-discovery-v1',
            runId,
            head: run.head_sha,
            contract: c,
            input,
          }),
        )
      ).slice(0, 48);
    try {
      const candidate = await createCandidateRecord(
        env,
        runId,
        'system:additional-discovery-v1',
        input,
        id,
      );
      candidateIds.push(candidate.id);
    } catch (error) {
      if (error instanceof AdditionalContributionError && error.status === 409)
        continue;
      throw error;
    }
  }
  return {
    status: candidateIds.length ? 'SUGGESTED' : 'NO_SUGGESTIONS',
    candidateIds,
  };
}
