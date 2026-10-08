import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { canonical, digest } from './domain';
import { GitHub } from './github';
import type { Env } from './env';
import { boundedBody, redact } from './security';
import {
  runnerRequestSchema,
  validateRunnerResult,
  type RunnerRequest,
} from './runner';
const keys = createRemoteJWKSet(
  new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),
);
export function actionsConfig(env: Env) {
  const repository = env.RUNNER_ACTIONS_REPOSITORY ?? '';
  const repositoryId = env.RUNNER_ACTIONS_REPOSITORY_ID ?? '';
  const ref = env.RUNNER_ACTIONS_REF ?? '';
  const sha = env.RUNNER_ACTIONS_SHA ?? '';
  const origin = env.RUNNER_ACTIONS_ORIGIN ?? '';
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    !/^[1-9]\d*$/.test(repositoryId) ||
    !/^[A-Za-z0-9][\w./-]{0,100}$/.test(ref) ||
    ref.includes('..') ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    !/^qemu-vm@sha256:[a-f0-9]{64}$/.test(env.RUNNER_IMAGE_URI ?? '')
  )
    throw new Error('ACTIONS_RUNNER_NOT_CONFIGURED');
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' ||
    url.origin !== origin ||
    url.username ||
    url.password
  )
    throw new Error('ACTIONS_RUNNER_ORIGIN_INVALID');
  return { repository, repositoryId, ref, sha, origin };
}
export function assertRunnerIdentity(env: Env, claims: JWTPayload) {
  const config = actionsConfig(env);
  if (
    claims.repository !== config.repository ||
    claims.repository_id !== config.repositoryId ||
    claims.workflow_ref !==
      `${config.repository}/.github/workflows/evaluate.yml@refs/heads/${config.ref}` ||
    claims.workflow_sha !== config.sha ||
    claims.event_name !== 'workflow_dispatch' ||
    typeof claims.run_id !== 'string' ||
    !/^[1-9]\d*$/.test(claims.run_id) ||
    typeof claims.run_attempt !== 'string' ||
    !/^[1-9]\d*$/.test(claims.run_attempt)
  )
    throw new Error('ACTIONS_RUNNER_IDENTITY_MISMATCH');
  return { runId: claims.run_id, runAttempt: claims.run_attempt };
}
export async function verifyRunnerIdentity(env: Env, token: string) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: 'https://token.actions.githubusercontent.com',
    audience: actionsConfig(env).origin,
    algorithms: ['RS256'],
    maxTokenAge: '10 minutes',
  });
  return assertRunnerIdentity(env, payload);
}
type Job = {
  id: string;
  request: string;
  request_hash: string;
  run_id: string;
  expires_at: number;
  github_run_id: string | null;
  github_run_attempt: string | null;
  result: string | null;
  synthetic: number;
  claimed_at: number | null;
  dispatch_error: string | null;
};
const EXECUTION_DEADLINE_MS = 12 * 60_000;
const QUEUE_DEADLINE_MS = 2 * 60 * 60_000;
function expired(job: Pick<Job, 'expires_at' | 'claimed_at'>) {
  return (
    job.expires_at <= Date.now() ||
    (job.claimed_at !== null &&
      job.claimed_at + EXECUTION_DEADLINE_MS <= Date.now())
  );
}
export async function actionsBroker(
  request: Request,
  env: Env,
  verify = verifyRunnerIdentity,
): Promise<Response> {
  if (env.RUNNER_ENABLED !== 'true' || env.RUNNER_BACKEND !== 'actions-vm')
    return Response.json({ error: 'RUNNER_DISABLED' }, { status: 503 });
  const match =
    /^\/api\/runner\/actions\/([a-f0-9-]{36})\/(claim|result)$/.exec(
      new URL(request.url).pathname,
    );
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!match || request.method !== 'POST' || !token)
    return new Response(null, { status: 401 });
  let identity: { runId: string; runAttempt: string };
  try {
    identity = await verify(env, token);
  } catch {
    return new Response(null, { status: 401 });
  }
  // Organization and public evaluator attempts live in distinct databases.
  const databases = [
    env.DB,
    ...(env.ORG_DB && env.ORG_DB !== env.DB ? [env.ORG_DB] : []),
  ];
  const found = await Promise.all(
    databases.map(async (db) => ({
      db,
      job: await db
        .prepare('SELECT * FROM actions_runner_jobs WHERE id=?')
        .bind(match[1])
        .first<Job>(),
    })),
  );
  const matches = found.filter((item) => item.job);
  if (matches.length !== 1) return new Response(null, { status: 410 });
  const { db, job } = matches[0]!;
  if (!job || expired(job) || job.dispatch_error)
    return new Response(null, { status: 410 });
  if (!job.synthetic) {
    const current = await db
      .prepare(
        "SELECT e.id FROM evaluations e JOIN submissions s ON s.repository_id=e.repository_id AND s.pr_number=e.pr_number WHERE e.id=? AND e.state='CHECKING' AND s.latest_run_id=e.id AND s.head_sha=e.head_sha AND s.closed=0",
      )
      .bind(job.run_id)
      .first();
    if (!current) return new Response(null, { status: 409 });
  }
  const headers = { 'cache-control': 'no-store' };
  if (match[2] === 'claim') {
    const claimed = await db
      .prepare(
        'UPDATE actions_runner_jobs SET github_run_id=?,github_run_attempt=?,claimed_at=? WHERE id=? AND github_run_id IS NULL AND expires_at>? AND result IS NULL AND dispatch_error IS NULL',
      )
      .bind(identity.runId, identity.runAttempt, Date.now(), job.id, Date.now())
      .run();
    // Retries by the same immutable Actions attempt may retrieve their input.
    if (
      !claimed.meta.changes &&
      (job.github_run_id !== identity.runId ||
        job.github_run_attempt !== identity.runAttempt ||
        job.result)
    )
      return new Response(null, { status: 409 });
    return new Response(job.request, {
      headers: { ...headers, 'content-type': 'application/json' },
    });
  }
  if (
    job.github_run_id !== identity.runId ||
    job.github_run_attempt !== identity.runAttempt ||
    job.result
  )
    return new Response(null, { status: 409 });
  const bytes = await boundedBody(request, 512000);
  const input = runnerRequestSchema.parse(JSON.parse(job.request));
  const result = validateRunnerResult(
    JSON.parse(new TextDecoder().decode(bytes)),
    input,
    job.request_hash,
  );
  const stored = canonical(result);
  const changed = await db
    .prepare(
      'UPDATE actions_runner_jobs SET result=?,result_hash=?,completed_at=? WHERE id=? AND github_run_id=? AND github_run_attempt=? AND result IS NULL AND expires_at>? AND (claimed_at IS NULL OR claimed_at>?) AND dispatch_error IS NULL',
    )
    .bind(
      redact(stored),
      await digest(redact(stored)),
      Date.now(),
      job.id,
      identity.runId,
      identity.runAttempt,
      Date.now(),
      Date.now() - EXECUTION_DEADLINE_MS,
    )
    .run();
  return new Response(null, {
    status: changed.meta.changes ? 204 : 409,
    headers,
  });
}
export async function actionsEvaluate(
  env: Env,
  raw: RunnerRequest,
  synthetic = false,
  assertCurrent: () => Promise<void> = async () => {},
  options: { defer?: boolean } = {},
) {
  const config = actionsConfig(env);
  const request = runnerRequestSchema.parse(raw);
  if (request.policy.image !== env.RUNNER_IMAGE_URI)
    throw new Error('ACTIONS_RUNNER_IMAGE_MISMATCH');
  if (
    !env.RUNNER_APP_ID ||
    !env.RUNNER_APP_PRIVATE_KEY ||
    !/^[1-9]\d*$/.test(env.RUNNER_INSTALLATION_ID ?? '')
  )
    throw new Error('ACTIONS_RUNNER_APP_NOT_CONFIGURED');
  await assertCurrent();
  const body = canonical(request),
    hash = await digest(body);
  const existing = await env.DB.prepare(
    'SELECT * FROM actions_runner_jobs WHERE run_id=? AND request_hash=? AND synthetic=? AND dispatch_error IS NULL ORDER BY rowid DESC LIMIT 1',
  )
    .bind(request.runId, hash, synthetic ? 1 : 0)
    .first<Job>();
  if (existing) {
    if (existing.request !== body)
      throw new Error('ACTIONS_RUNNER_INPUT_MISMATCH');
    if (existing.result)
      return validateRunnerResult(JSON.parse(existing.result), request, hash);
    if (expired(existing)) throw new Error('ACTIONS_RUNNER_QUEUE_TIMEOUT');
    if (options.defer) throw new Error('RUNNER_PENDING');
    return waitForResult(env, existing.id, request, hash, assertCurrent);
  }
  const failed = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM actions_runner_jobs WHERE run_id=? AND request_hash=? AND dispatch_error IS NOT NULL',
  )
    .bind(request.runId, hash)
    .first<{ n: number }>();
  if ((failed?.n ?? 0) >= 8)
    throw new Error('ACTIONS_RUNNER_DISPATCH_UNAVAILABLE');
  const app = await GitHub.application({
    ...env,
    GITHUB_APP_ID: env.RUNNER_APP_ID,
    GITHUB_APP_PRIVATE_KEY: env.RUNNER_APP_PRIVATE_KEY,
  });
  const { token } = await app.api<{ token: string }>(
    `/app/installations/${env.RUNNER_INSTALLATION_ID}/access_tokens`,
    {
      method: 'POST',
      body: JSON.stringify({
        repository_ids: [Number(config.repositoryId)],
        permissions: { actions: 'write', contents: 'read' },
      }),
    },
  );
  const github = new GitHub(token, env.DB, env.CAPACITY_DB ?? env.DB);
  const repository = await github.api<{ id: number; private: boolean }>(
    `/repos/${config.repository}`,
  );
  if (String(repository.id) !== config.repositoryId || repository.private)
    throw new Error('ACTIONS_RUNNER_PUBLIC_REPOSITORY_REQUIRED');
  const branch = await github.api<{ commit: { sha: string } }>(
    `/repos/${config.repository}/branches/${encodeURIComponent(config.ref)}`,
  );
  if (branch.commit.sha !== config.sha)
    throw new Error('ACTIONS_RUNNER_WORKFLOW_CHANGED');
  const id = crypto.randomUUID();
  if (new TextEncoder().encode(body).length > 850000)
    throw new Error('ACTIONS_RUNNER_REQUEST_LIMIT');
  const expires =
    Date.now() + (options.defer ? QUEUE_DEADLINE_MS : EXECUTION_DEADLINE_MS);
  await assertCurrent();
  await env.DB.prepare(
    'INSERT INTO actions_runner_jobs(id,run_id,request_hash,request,expires_at,synthetic) VALUES(?,?,?,?,?,?)',
  )
    .bind(id, request.runId, hash, body, expires, synthetic ? 1 : 0)
    .run();
  try {
    await github.api(
      `/repos/${config.repository}/actions/workflows/evaluate.yml/dispatches`,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: config.ref,
          inputs: { job_id: id, judge_origin: config.origin },
        }),
      },
    );
  } catch (error) {
    // An ambiguous dispatch is retained but fenced: a retry creates a new
    // attempt and a delayed Actions run cannot claim the abandoned input.
    const code =
      error instanceof Error && /^GITHUB_HTTP_\d+$/.test(error.message)
        ? error.message
        : 'ACTIONS_DISPATCH_UNAVAILABLE';
    await env.DB.prepare(
      'UPDATE actions_runner_jobs SET dispatch_error=? WHERE id=? AND github_run_id IS NULL AND result IS NULL',
    )
      .bind(code, id)
      .run();
    throw new Error('RUNNER_PENDING');
  }
  if (options.defer) throw new Error('RUNNER_PENDING');
  return waitForResult(env, id, request, hash, assertCurrent);
}
async function waitForResult(
  env: Env,
  id: string,
  request: RunnerRequest,
  hash: string,
  assertCurrent: () => Promise<void>,
) {
  for (;;) {
    await assertCurrent();
    const job = await env.DB.prepare(
      'SELECT * FROM actions_runner_jobs WHERE id=?',
    )
      .bind(id)
      .first<Job>();
    if (job?.result)
      return validateRunnerResult(JSON.parse(job.result), request, hash);
    if (!job || expired(job) || job.dispatch_error)
      throw new Error('ACTIONS_RUNNER_QUEUE_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

// Resume a durable poll from the exact frozen source snapshot instead of
// re-downloading participant files on each queue wake-up.
export async function frozenActionsInput(
  env: Env,
  descriptor: Omit<RunnerRequest, 'files'>,
) {
  const expected = runnerRequestSchema.parse({ ...descriptor, files: [] });
  // A waiting poll needs only transport metadata and the small frozen policy,
  // not up to 750KB of source. Fetch/decode source only for a completed result.
  const pending = await env.DB.prepare(
    "SELECT id,expires_at,claimed_at,result IS NOT NULL AS ready,json_extract(request,'$.contractHash') AS contractHash,json_extract(request,'$.policy') AS policy,json_extract(request,'$.timeoutSeconds') AS timeoutSeconds,json_extract(request,'$.memoryMiB') AS memoryMiB FROM actions_runner_jobs WHERE run_id=? AND json_extract(request,'$.commit')=? AND synthetic=0 AND dispatch_error IS NULL ORDER BY rowid DESC LIMIT 1",
  )
    .bind(descriptor.runId, descriptor.commit)
    .first<{
      id: string;
      expires_at: number;
      claimed_at: number | null;
      ready: number;
      contractHash: string;
      policy: string;
      timeoutSeconds: number;
      memoryMiB: number;
    }>();
  if (!pending) return null;
  if (
    pending.contractHash !== expected.contractHash ||
    canonical(JSON.parse(pending.policy)) !== canonical(expected.policy) ||
    pending.timeoutSeconds !== expected.timeoutSeconds ||
    pending.memoryMiB !== expected.memoryMiB
  )
    throw new Error('ACTIONS_RUNNER_INPUT_MISMATCH');
  if (!pending.ready) {
    if (expired(pending)) throw new Error('ACTIONS_RUNNER_QUEUE_TIMEOUT');
    throw new Error('RUNNER_PENDING');
  }
  const job = await env.DB.prepare(
    'SELECT * FROM actions_runner_jobs WHERE id=?',
  )
    .bind(pending.id)
    .first<Job>();
  if (!job) return null;
  const input = runnerRequestSchema.parse(JSON.parse(job.request));
  if (
    canonical({ ...input, files: [] }) !== canonical(expected) ||
    (await digest(canonical(input))) !== job.request_hash
  )
    throw new Error('ACTIONS_RUNNER_INPUT_MISMATCH');
  return input;
}
