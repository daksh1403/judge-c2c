import { canonical, digest } from './domain';
import { redact } from './security';
import type { Env } from './env';
import { checkResultSchema, type RunnerResult } from './runner';
export const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
export const MAX_RUN_ARTIFACT_BYTES = 20 * 1024 * 1024;
const MAX_CAPTURE_ARTIFACTS = 128;
const MAX_ATTEMPTS = 5;
const UPLOAD_LEASE_MS = 5 * 60_000;
export type ArtifactMetadata = {
  key: string;
  run_id: string;
  sha256: string;
  bytes: number;
  content_type: string;
  created_at: string;
  kind: string;
  storage: 'R2' | 'KV';
  status: 'PENDING' | 'STORED' | 'FAILED' | 'DELETED';
  expires_at: number | null;
  error_code: string | null;
  attempts: number;
  upload_token: string | null;
  upload_lease_until: number | null;
  delete_token: string | null;
  cleanup_after: number | null;
};
const encoder = new TextEncoder();
const metadata = (env: Env, key: string) =>
  env.DB.prepare('SELECT * FROM artifacts WHERE key=?')
    .bind(key)
    .first<ArtifactMetadata>();
function adapter(env: Env, storage?: ArtifactMetadata['storage']) {
  const type =
    storage ?? (env.ARTIFACTS ? 'R2' : env.ARTIFACT_KV ? 'KV' : null);
  if (type === 'R2' && env.ARTIFACTS)
    return {
      type,
      put: async (key: string, content: string, expires: number) => {
        await env.ARTIFACTS!.put(key, content, {
          httpMetadata: { contentType: 'application/octet-stream' },
          customMetadata: { expiresAt: String(expires) },
        });
      },
      get: async (key: string) => {
        const object = await env.ARTIFACTS!.get(key);
        return object ? object.arrayBuffer() : null;
      },
      delete: async (key: string) => {
        await env.ARTIFACTS!.delete(key);
      },
    };
  if (type === 'KV' && env.ARTIFACT_KV)
    return {
      type,
      put: async (key: string, content: string, expires: number) => {
        await env.ARTIFACT_KV!.put(key, content, {
          expiration: Math.ceil(expires / 1000),
        });
      },
      get: async (key: string) => env.ARTIFACT_KV!.get(key, 'arrayBuffer'),
      delete: async (key: string) => {
        await env.ARTIFACT_KV!.delete(key);
      },
    };
  throw Error('ARTIFACT_STORAGE_UNAVAILABLE');
}
async function attempt(
  env: Env,
  key: string,
  action: 'STORE' | 'DELETE',
  status: 'STARTED' | 'SUCCEEDED' | 'FAILED',
  code: string | null = null,
) {
  await env.DB.prepare(
    'INSERT INTO artifact_attempts(id,artifact_key,action,status,code) VALUES(?,?,?,?,?)',
  )
    .bind(crypto.randomUUID(), key, action, status, code)
    .run();
}
export async function storeArtifact(
  env: Env,
  runId: string,
  kind: string,
  raw: string,
  contentType = 'application/json',
): Promise<ArtifactMetadata> {
  if (!/^[a-f0-9]{64}$/.test(runId) || !/^[a-z][a-z0-9-]{0,79}$/.test(kind))
    throw Error('ARTIFACT_ID_INVALID');
  if (encoder.encode(raw).length > MAX_ARTIFACT_BYTES)
    throw Error('ARTIFACT_LIMIT');
  const content = redact(raw),
    bytes = encoder.encode(content).length,
    hash = await digest(content);
  if (bytes > MAX_ARTIFACT_BYTES) throw Error('ARTIFACT_LIMIT');
  const key = `evaluations/${runId}/${kind}/${hash}`;
  const storage = adapter(env);
  const expires = Date.now() + 90 * 86400000;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO artifacts(key,run_id,sha256,bytes,content_type,kind,storage,status,expires_at) SELECT ?,?,?,?,?,?,?,'PENDING',? WHERE EXISTS(SELECT 1 FROM evaluations WHERE id=?) AND (SELECT coalesce(sum(bytes),0) FROM artifacts WHERE run_id=?) + ? <= ?",
  )
    .bind(
      key,
      runId,
      hash,
      bytes,
      contentType,
      kind,
      storage.type,
      expires,
      runId,
      runId,
      bytes,
      MAX_RUN_ARTIFACT_BYTES,
    )
    .run();
  const original = await metadata(env, key);
  if (!original) throw Error('ARTIFACT_RUN_BUDGET_OR_RUN_MISSING');
  if (
    original.status === 'DELETED' ||
    (original.expires_at !== null && original.expires_at <= Date.now())
  )
    throw Error('ARTIFACT_EXPIRED');
  if (original.status === 'STORED') return original;
  // An atomic attempt reservation serializes same-key uploads and caps recovery.
  const token = crypto.randomUUID();
  const acquired = await env.DB.prepare(
    "UPDATE artifacts SET status='PENDING',attempts=attempts+1,error_code='UPLOAD_IN_PROGRESS',upload_token=?,upload_lease_until=? WHERE key=? AND status IN('FAILED','PENDING') AND (upload_lease_until IS NULL OR upload_lease_until<=?) AND attempts<? AND expires_at>?",
  )
    .bind(
      token,
      Date.now() + UPLOAD_LEASE_MS,
      key,
      Date.now(),
      MAX_ATTEMPTS,
      Date.now(),
    )
    .run();
  if (!acquired.meta.changes)
    throw Error('ARTIFACT_UPLOAD_BUSY_OR_RETRY_LIMIT');
  await attempt(env, key, 'STORE', 'STARTED');
  try {
    await adapter(env, original.storage).put(
      key,
      content,
      original.expires_at!,
    );
    const completed = await env.DB.prepare(
      "UPDATE artifacts SET status='STORED',error_code=NULL,upload_token=NULL,upload_lease_until=NULL WHERE key=? AND status='PENDING' AND upload_token=? AND expires_at>?",
    )
      .bind(key, token, Date.now())
      .run();
    if (!completed.meta.changes) {
      const latest = await metadata(env, key);
      if (
        latest?.status === 'DELETED' ||
        (latest?.expires_at != null && latest.expires_at <= Date.now())
      ) {
        const deletion = crypto.randomUUID();
        await env.DB.prepare(
          "UPDATE artifacts SET status='DELETED',error_code='ARTIFACT_DELETE_PENDING',upload_token=NULL,upload_lease_until=NULL,delete_token=?,cleanup_after=? WHERE key=? AND (status='DELETED' OR expires_at<=?)",
        )
          .bind(deletion, Date.now(), key, Date.now())
          .run();
        try {
          await adapter(env, original.storage).delete(key);
          await env.DB.prepare(
            "UPDATE artifacts SET error_code='ARTIFACT_EXPIRED',cleanup_after=? WHERE key=? AND status='DELETED' AND delete_token=?",
          )
            .bind(Date.now() + 86400000, key, deletion)
            .run();
        } catch {
          /* Durable pending cleanup remains available to the next sweep. */
        }
      }
      throw Error('ARTIFACT_EXPIRED_DURING_UPLOAD');
    }
    await attempt(env, key, 'STORE', 'SUCCEEDED');
  } catch {
    await env.DB.prepare(
      "UPDATE artifacts SET status='FAILED',error_code='ARTIFACT_UPLOAD_FAILED',upload_token=NULL,upload_lease_until=NULL WHERE key=? AND status='PENDING' AND upload_token=? AND expires_at>?",
    )
      .bind(key, token, Date.now())
      .run();
    await attempt(env, key, 'STORE', 'FAILED', 'ARTIFACT_UPLOAD_FAILED');
    throw Error('ARTIFACT_UPLOAD_FAILED');
  }
  return (await metadata(env, key))!;
}
export async function readArtifact(env: Env, key: string): Promise<Response> {
  if (key.length > 240)
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  const record = await metadata(env, key);
  if (!record) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (
    record.status === 'DELETED' ||
    (record.expires_at !== null && record.expires_at <= Date.now())
  )
    return Response.json({ error: 'ARTIFACT_EXPIRED' }, { status: 410 });
  if (record.status !== 'STORED')
    return Response.json(
      { error: 'ARTIFACT_NOT_AVAILABLE' },
      { status: 503, headers: { 'retry-after': '60' } },
    );
  try {
    const buffer = await adapter(env, record.storage).get(key);
    if (!buffer)
      return Response.json(
        { error: 'ARTIFACT_NOT_YET_VISIBLE' },
        { status: 503, headers: { 'retry-after': '60' } },
      );
    if (
      buffer.byteLength > MAX_ARTIFACT_BYTES ||
      buffer.byteLength !== record.bytes ||
      (await digest(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          buffer,
        ),
      )) !== record.sha256
    )
      return Response.json(
        { error: 'ARTIFACT_INTEGRITY_MISMATCH' },
        { status: 502 },
      );
    // Re-check retention after the asynchronous backing-store read.
    const current = await metadata(env, key);
    if (
      !current ||
      current.status !== 'STORED' ||
      (current.expires_at !== null && current.expires_at <= Date.now())
    )
      return Response.json({ error: 'ARTIFACT_EXPIRED' }, { status: 410 });
    return new Response(buffer, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${/^[a-z][a-z0-9-]{0,79}$/.test(record.kind) ? record.kind : 'evidence'}.txt"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-artifact-sha256': record.sha256,
      },
    });
  } catch {
    return Response.json(
      { error: 'ARTIFACT_STORAGE_UNAVAILABLE' },
      { status: 503 },
    );
  }
}
export async function expireArtifacts(env: Env, now = Date.now()) {
  // Revisit tombstones daily: a guest/store callback can complete after cleanup,
  // or crash after its final write. Expired content is never downloadable.
  const rows = await env.DB.prepare(
    'SELECT * FROM artifacts WHERE expires_at<=? AND (cleanup_after IS NULL OR cleanup_after<=?) ORDER BY coalesce(cleanup_after,0),expires_at LIMIT 50',
  )
    .bind(now, now)
    .all<ArtifactMetadata>();
  for (const row of rows.results) {
    const token = crypto.randomUUID();
    const changed = await env.DB.prepare(
      "UPDATE artifacts SET status='DELETED',error_code='ARTIFACT_DELETE_PENDING',upload_token=NULL,upload_lease_until=NULL,delete_token=?,cleanup_after=? WHERE key=? AND expires_at<=? AND (cleanup_after IS NULL OR cleanup_after<=?)",
    )
      .bind(token, now + UPLOAD_LEASE_MS, row.key, now, now)
      .run();
    if (!changed.meta.changes) continue;
    await attempt(env, row.key, 'DELETE', 'STARTED');
    try {
      await adapter(env, row.storage).delete(row.key);
      await env.DB.prepare(
        "UPDATE artifacts SET error_code='ARTIFACT_EXPIRED',cleanup_after=? WHERE key=? AND status='DELETED' AND delete_token=?",
      )
        .bind(now + 86400000, row.key, token)
        .run();
      await attempt(env, row.key, 'DELETE', 'SUCCEEDED');
    } catch {
      await env.DB.prepare(
        "UPDATE artifacts SET error_code='ARTIFACT_DELETE_FAILED',cleanup_after=? WHERE key=? AND status='DELETED' AND delete_token=?",
      )
        .bind(now, row.key, token)
        .run();
      await attempt(env, row.key, 'DELETE', 'FAILED', 'ARTIFACT_DELETE_FAILED');
    }
  }
}
export async function captureRunArtifacts(env: Env, runId: string) {
  const run = await env.DB.prepare(
    'SELECT evidence,context,report,baseline_sha FROM evaluations WHERE id=?',
  )
    .bind(runId)
    .first<{
      evidence: string | null;
      context: string | null;
      report: string | null;
      baseline_sha: string;
    }>();
  if (!run) throw Error('RUN_MISSING');
  const entries: [string, string, string][] = [];
  for (const key of ['evidence', 'context', 'report'] as const)
    if (run[key]) entries.push([key, run[key]!, 'application/json']);
  const failures: { kind: string; code: string }[] = [];
  // Diff context is data, never rendered/executed as code. Preserve uncertainty
  // on omitted or truncated patches instead of inventing a complete diff.
  if (run.context)
    try {
      if (encoder.encode(run.context).length > MAX_ARTIFACT_BYTES)
        throw Error('limit');
      const context = JSON.parse(run.context);
      if (!Array.isArray(context.files) || context.files.length > 100)
        throw Error('shape');
      let budget = 1_000_000;
      const files = context.files.map((file: Record<string, unknown>) => {
        if (typeof file.filename !== 'string' || file.filename.length > 240)
          throw Error('path');
        const original = typeof file.patch === 'string' ? file.patch : null;
        const patch =
          original === null
            ? null
            : original.slice(0, Math.max(0, Math.min(16000, budget)));
        budget -= patch?.length ?? 0;
        return {
          filename: file.filename,
          previousFilename:
            typeof file.previous_filename === 'string'
              ? file.previous_filename.slice(0, 240)
              : null,
          status:
            typeof file.status === 'string'
              ? file.status.slice(0, 40)
              : 'unknown',
          patch,
          patchTruncated:
            file.patchTruncated === true ||
            original === null ||
            original.length !== patch?.length,
        };
      });
      entries.push([
        'diff',
        canonical({
          schemaVersion: 1,
          runId,
          baseline: run.baseline_sha,
          complete: files.every(
            (f: { patchTruncated: boolean }) => !f.patchTruncated,
          ),
          files,
          scope:
            'Captured baseline-to-head changed-path context. Missing or truncated patches are explicitly incomplete; this is not functional evidence.',
        }),
        'application/json',
      ]);
    } catch {
      failures.push({ kind: 'diff', code: 'ARTIFACT_DIFF_CONTEXT_MALFORMED' });
    }
  const execution = await env.DB.prepare(
    'SELECT commit_sha,result FROM execution_results WHERE run_id=? ORDER BY created_at LIMIT 17',
  )
    .bind(runId)
    .all<{ commit_sha: string; result: string }>();
  let n = 0;
  if (execution.results.length > 16)
    failures.push({ kind: 'capture', code: 'ARTIFACT_EXECUTION_COUNT_LIMIT' });
  for (const row of execution.results.slice(0, 16)) {
    const side =
      row.commit_sha === run.baseline_sha ? 'baseline' : 'submission';
    entries.push([`execution-${side}-${n}`, row.result, 'application/json']);
    try {
      if (encoder.encode(row.result).length > MAX_ARTIFACT_BYTES)
        throw Error('limit');
      const result = JSON.parse(row.result);
      if (
        !Array.isArray(result.checks) ||
        result.checks.length > 42 ||
        (result.commit && result.commit !== row.commit_sha)
      )
        throw Error('shape');
      const checks: RunnerResult['checks'] = result.checks.map(
        (check: unknown) => checkResultSchema.parse(check),
      );
      for (const stream of ['stdout', 'stderr'] as const)
        entries.push([
          `${stream}-${side}-${n}`,
          checks
            .map((c) => `[${c.kind}:${c.id}]\n${c[stream] ?? ''}`)
            .join('\n'),
          'text/plain',
        ]);
      for (const [index, check] of checks.entries()) {
        let category = 'check';
        const executed =
          check.status !== 'UNVERIFIED' && check.exitCode !== null;
        if (executed && ['test', 'integration'].includes(check.kind))
          category = 'tests';
        if (executed && check.kind === 'security') category = 'security';
        // An empty coverage command produces no coverage report. Its diagnostic
        // still exists, but cannot satisfy a required coverage artifact.
        if (executed && check.kind === 'coverage' && check.stdout.trim())
          category = 'coverage';
        if (check.kind === 'benchmark' && check.status !== 'UNVERIFIED') {
          try {
            const measured = JSON.parse(check.stdout);
            if (
              measured.protocol === 'http-latency-v1' &&
              Array.isArray(measured.samplesMs) &&
              measured.samplesMs.length >= 10 &&
              measured.samplesMs.length <= 30 &&
              measured.samplesMs.every(
                (v: unknown) =>
                  typeof v === 'number' && Number.isFinite(v) && v >= 0,
              ) &&
              typeof measured.p95Ms === 'number' &&
              Number.isFinite(measured.p95Ms)
            )
              category = 'benchmark';
          } catch {
            /* Incomplete benchmark stays diagnostic, not a measured report. */
          }
        }
        entries.push([
          `${category}-${side}-${n}-${index}`,
          canonical({
            schemaVersion: 1,
            runId,
            commit: row.commit_sha,
            side,
            executionIndex: n,
            checkIndex: index,
            requestHash: result.requestHash ?? null,
            evaluatorVersion: result.version ?? null,
            image: result.image ?? null,
            runtime: result.runtime ?? null,
            startedAt: result.startedAt ?? null,
            finishedAt: result.finishedAt ?? null,
            check,
            provenance:
              check.kind === 'benchmark' || check.kind === 'acceptance'
                ? 'Trusted runner observation'
                : 'Configured repository command; participant output is hostile data and supplemental evidence',
            scope:
              category === 'coverage'
                ? 'Captured coverage-command output; no coverage percentage or adequacy is inferred.'
                : 'Captured check record; artifact availability is not proof of criterion correctness.',
          }),
          'application/json',
        ]);
      }
    } catch {
      failures.push({
        kind: `execution-${side}-${n}`,
        code: 'ARTIFACT_EXECUTION_MALFORMED',
      });
    }
    n++;
  }
  if (entries.length > MAX_CAPTURE_ARTIFACTS)
    failures.push({ kind: 'capture', code: 'ARTIFACT_COUNT_LIMIT' });
  for (const [kind, text, type] of entries.slice(0, MAX_CAPTURE_ARTIFACTS)) {
    try {
      await storeArtifact(env, runId, kind, text, type);
    } catch (error) {
      failures.push({
        kind,
        code:
          error instanceof Error && /^ARTIFACT_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'ARTIFACT_CAPTURE_FAILED',
      });
    }
  }
  const artifacts = (
    await env.DB.prepare(
      'SELECT * FROM artifacts WHERE run_id=? ORDER BY created_at,key',
    )
      .bind(runId)
      .all<ArtifactMetadata>()
  ).results;
  return {
    runId,
    status: failures.length ? ('PARTIAL' as const) : ('CAPTURED' as const),
    artifacts,
    failures,
  };
}
