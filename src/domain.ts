import { z } from 'zod';

export const sha = z.string().regex(/^[a-f0-9]{40}$/);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/);
export const pathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (p) => !p.startsWith('/') && !p.includes('..') && !/[\x00-\x1f\\]/.test(p),
    'Unsafe path',
  );
export const criterionSchema = z
  .object({
    id,
    description: z.string().min(1).max(2000),
    kind: z.enum(['functional', 'source', 'documentation']),
    verification: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('file_contains'),
          path: pathSchema,
          text: z.string().min(1).max(1000),
        })
        .strict(),
      z.object({ type: z.literal('human') }).strict(),
      z.object({ type: z.literal('runner'), checkId: id }).strict(),
    ]),
  })
  .strict()
  .refine(
    (c) => c.kind !== 'functional' || c.verification.type !== 'file_contains',
    'Functional behavior needs execution or human verification',
  );
export const contractSchema = z
  .object({
    schemaVersion: z.literal(1),
    evaluationVersion: id,
    challengeVersion: id,
    repository: z
      .object({
        id: z.number().int().positive(),
        fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
        installationId: z.number().int().positive(),
      })
      .strict(),
    department: z.string().min(1).max(100),
    category: z.string().min(1).max(100),
    baseline: sha,
    issueNumbers: z.array(z.number().int().positive()).min(1).max(30),
    requirements: z
      .array(
        z
          .object({
            id,
            title: z.string().min(1).max(200),
            mandatory: z.boolean(),
            criteria: z.array(criterionSchema).min(1).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    constraints: z.array(z.string().min(1).max(1000)).max(50),
    forbiddenPaths: z.array(pathSchema).max(50),
    additionalCategories: z.array(z.string().min(1).max(80)).max(20),
    execution: z
      .object({
        environment: id,
        network: z.literal('deny'),
        timeoutSeconds: z.number().int().min(1).max(600),
        memoryMiB: z.number().int().min(64).max(4096),
        maxFiles: z.number().int().min(1).max(100),
        maxFileBytes: z.number().int().min(1).max(100000),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const keys = c.requirements.flatMap((r) => [
      r.id,
      ...r.criteria.map((a) => a.id),
    ]);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Requirement and criterion IDs must be globally unique',
      });
  });
export type Contract = z.infer<typeof contractSchema>;
export const states = [
  'CREATED',
  'QUEUED',
  'FETCHING',
  'CHECKING',
  'REVIEWING',
  'SYNTHESIZING',
  'COMPLETED',
  'FAILED',
  'SUPERSEDED',
] as const;
export type State = (typeof states)[number];
const next: Record<State, readonly State[]> = {
  CREATED: ['QUEUED', 'SUPERSEDED'],
  QUEUED: ['FETCHING', 'FAILED', 'SUPERSEDED'],
  FETCHING: ['CHECKING', 'FAILED', 'SUPERSEDED'],
  CHECKING: ['REVIEWING', 'FAILED', 'SUPERSEDED'],
  REVIEWING: ['SYNTHESIZING', 'FAILED', 'SUPERSEDED'],
  SYNTHESIZING: ['COMPLETED', 'FAILED', 'SUPERSEDED'],
  COMPLETED: [],
  FAILED: [],
  SUPERSEDED: [],
};
export function canTransition(from: State, to: State) {
  return next[from].includes(to);
}
export async function digest(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export function canonical(value: unknown): string {
  if (Array.isArray(value))
    return (
      '[' +
      value.map((v) => (v === undefined ? 'null' : canonical(v))).join(',') +
      ']'
    );
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export async function evaluationIdentity(
  repositoryId: number,
  pr: number,
  head: string,
  contractHash: string,
  assignmentHash: string,
) {
  return digest(
    canonical({ repositoryId, pr, head, contractHash, assignmentHash }),
  );
}
export type Evidence = {
  id: string;
  kind: 'diff' | 'source' | 'policy' | 'execution';
  claim: string;
  status: 'PASS' | 'FAIL' | 'UNVERIFIED';
  baselineStatus?: 'PASS' | 'FAIL' | 'UNVERIFIED';
  path?: string;
  criterionId?: string;
  artifactKey?: string;
  hash?: string;
};
export const assessmentSchema = z
  .object({
    criterionId: id,
    status: z.enum(['PASS', 'PARTIAL', 'FAIL', 'NOT_APPLICABLE', 'UNVERIFIED']),
    explanation: z.string().min(1).max(2000),
    evidenceIds: z.array(z.string().min(1).max(100)).max(20),
  })
  .strict();
export const reviewSchema = z
  .object({
    summary: z.string().min(1).max(3000),
    assessments: z.array(assessmentSchema).max(900),
    findings: z
      .array(
        z
          .object({
            category: z.string().max(80),
            severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
            claim: z.string().min(1).max(2000),
            evidenceIds: z.array(z.string()).min(1).max(20),
            verification: z.literal('inference'),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type Review = z.infer<typeof reviewSchema>;
export function validateReview(
  value: unknown,
  contract: Contract,
  evidence: Evidence[],
): Review {
  const review = reviewSchema.parse(value);
  const criteria = contract.requirements.flatMap((r) => r.criteria);
  const keys = new Set(criteria.map((c) => c.id));
  if (
    review.assessments.length !== keys.size ||
    new Set(review.assessments.map((a) => a.criterionId)).size !== keys.size
  )
    throw new Error('AI must assess every criterion exactly once');
  const known = new Map(evidence.map((e) => [e.id, e]));
  for (const a of review.assessments) {
    if (!keys.has(a.criterionId) || a.evidenceIds.some((e) => !known.has(e)))
      throw new Error('Unknown criterion or evidence');
    const criterion = criteria.find((c) => c.id === a.criterionId)!;
    if (a.status === 'NOT_APPLICABLE')
      throw new Error('AI cannot waive authoritative criteria');
    const objective = evidence.find((e) => e.criterionId === a.criterionId);
    if (objective?.status === 'FAIL' && a.status !== 'FAIL')
      throw new Error('AI cannot override objective failure');
    if (
      a.status === 'PASS' &&
      !a.evidenceIds.some(
        (k) =>
          known.get(k)?.criterionId === a.criterionId &&
          known.get(k)?.status === 'PASS' &&
          (criterion.kind !== 'functional' ||
            known.get(k)?.kind === 'execution'),
      )
    )
      throw new Error('PASS requires relevant objective evidence');
    if (a.status !== 'UNVERIFIED' && a.evidenceIds.length === 0)
      throw new Error('Unsupported assessment');
    if (
      criterion.kind === 'functional' &&
      !evidence.some(
        (e) => e.criterionId === criterion.id && e.kind === 'execution',
      ) &&
      a.status !== 'UNVERIFIED'
    )
      throw new Error('Functional behavior is unverified without execution');
  }
  if (review.findings.some((f) => f.evidenceIds.some((e) => !known.has(e))))
    throw new Error('Unknown finding evidence');
  return review;
}
