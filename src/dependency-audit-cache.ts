import { z } from 'zod';
import { canonical, digest, type Evidence } from './domain';
import { dependencyAudit } from './dependency-audit';
import { RUNNER_VERSION } from './runner-policy';
import { redact } from './security';
const TTL_MS = 60 * 60 * 1000;
const MAX_BYTES = 262144;
type Input = { manifest: string | null; lock: string | null };
type Identity = {
  repositoryId: number;
  runId: string;
  baseline: string;
  head: string;
  contractHash: string;
  cache: 'NONE' | 'BASELINE' | 'ALL';
};
const evidenceSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^dependency-(?:audit|[a-f0-9]{24})$/),
        kind: z.literal('source'),
        status: z.enum(['PASS', 'FAIL']),
        baselineStatus: z.enum(['PASS', 'FAIL']).optional(),
        path: z.literal('package-lock.json').optional(),
        claim: z.string().max(8000),
      })
      .strict(),
  )
  .min(1)
  .max(1001);
/** Advisory snapshots are mutable-provider observations, never fresh scanner claims.
 * The whole exact baseline/head comparison is reused only for explicit cache opt-in.
 */
export async function cachedDependencyAudit(
  db: D1Database,
  identity: Identity,
  baseline: Input,
  head: Input,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  if (identity.cache === 'NONE')
    return dependencyAudit(baseline, head, fetcher);
  // BASELINE permits reuse only when the head's declared dependency inputs are
  // exactly the baseline inputs; changed-head comparisons require ALL opt-in.
  if (
    (identity.cache === 'BASELINE' &&
      (baseline.manifest !== head.manifest || baseline.lock !== head.lock)) ||
    !Number.isSafeInteger(identity.repositoryId) ||
    identity.repositoryId <= 0 ||
    !/^[a-f0-9]{64}$/.test(identity.runId) ||
    !/^[a-f0-9]{64}$/.test(identity.contractHash) ||
    !/^[a-f0-9]{40}$/.test(identity.baseline) ||
    !/^[a-f0-9]{40}$/.test(identity.head)
  )
    return dependencyAudit(baseline, head, fetcher);
  const expiresAt = (Math.floor(now / TTL_MS) + 1) * TTL_MS;
  const request = {
    schemaVersion: 1,
    repositoryId: identity.repositoryId,
    baseline: identity.baseline,
    head: identity.head,
    contractHash: identity.contractHash,
    auditor: 'npm-osv-v1',
    evaluator: RUNNER_VERSION,
    provider: 'https://api.osv.dev/v1/querybatch',
    snapshotHour: Math.floor(now / TTL_MS),
    inputs: await Promise.all(
      [baseline, head].map(async (input) => ({
        manifest: input.manifest === null ? null : await digest(input.manifest),
        lock: input.lock === null ? null : await digest(input.lock),
      })),
    ),
  };
  const serialized = canonical(request),
    key = await digest(serialized);
  const provenance = (
    evidence: Evidence[],
    status: 'HIT' | 'MISS',
    originRunId: string,
    queriedAt: number,
  ) =>
    evidence.map((e) => ({
      ...e,
      claim:
        e.claim +
        ` Advisory snapshot ${status}; origin run ${originRunId}; observed at ${new Date(queriedAt).toISOString()}; expires ${new Date(expiresAt).toISOString()}; cache ${key}. ${status === 'HIT' ? 'Reused historical advisory snapshot, not a fresh provider scan.' : 'Fresh comparison; cache population is best-effort.'}`,
    }));
  try {
    const row = await db
      .prepare(
        'SELECT c.*,e.repository_id AS origin_repository_id,e.contract_hash AS origin_contract_hash,e.baseline_sha AS origin_baseline,e.head_sha AS origin_head FROM dependency_audit_cache c JOIN evaluations e ON e.id=c.origin_run_id WHERE c.repository_id=? AND c.cache_key=?',
      )
      .bind(identity.repositoryId, key)
      .first<{
        request: string;
        result: string;
        result_hash: string;
        origin_run_id: string;
        origin_repository_id: number;
        origin_contract_hash: string;
        origin_baseline: string;
        origin_head: string;
        queried_at: number;
        expires_at: number;
      }>();
    if (
      row &&
      row.origin_repository_id === identity.repositoryId &&
      row.origin_contract_hash === identity.contractHash &&
      row.origin_baseline === identity.baseline &&
      row.origin_head === identity.head &&
      row.request === serialized &&
      row.expires_at === expiresAt &&
      row.queried_at <= now &&
      row.queried_at >= expiresAt - TTL_MS &&
      now < row.expires_at &&
      /^[a-f0-9]{64}$/.test(row.origin_run_id) &&
      new TextEncoder().encode(row.result).length <= MAX_BYTES &&
      (await digest(row.result)) === row.result_hash
    ) {
      const parsed = evidenceSchema.safeParse(JSON.parse(row.result));
      if (
        parsed.success &&
        parsed.data.some(
          (e) => e.id === 'dependency-audit' && e.status === 'PASS',
        ) &&
        new Set(parsed.data.map((e) => e.id)).size === parsed.data.length &&
        redact(row.result) === row.result
      )
        return provenance(
          parsed.data,
          'HIT',
          row.origin_run_id,
          row.queried_at,
        );
    }
  } catch {
    /* Missing/corrupt cache cannot suppress a fresh provider attempt. */
  }
  const evidence = await dependencyAudit(baseline, head, fetcher),
    stored = canonical(evidence);
  const valid = evidenceSchema.safeParse(evidence);
  if (
    valid.success &&
    valid.data.some(
      (e) => e.id === 'dependency-audit' && e.status === 'PASS',
    ) &&
    new TextEncoder().encode(stored).length <= MAX_BYTES &&
    redact(stored) === stored
  ) {
    try {
      await db
        .prepare(
          'INSERT OR IGNORE INTO dependency_audit_cache(repository_id,cache_key,origin_run_id,request,result,result_hash,queried_at,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM evaluations WHERE id=? AND repository_id=? AND contract_hash=? AND baseline_sha=? AND head_sha=?)',
        )
        .bind(
          identity.repositoryId,
          key,
          identity.runId,
          serialized,
          stored,
          await digest(stored),
          now,
          expiresAt,
          identity.runId,
          identity.repositoryId,
          identity.contractHash,
          identity.baseline,
          identity.head,
        )
        .run();
    } catch {
      /* Evidence survives cache storage failure. */
    }
    return provenance(evidence, 'MISS', identity.runId, now);
  }
  return evidence;
}
