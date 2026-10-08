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
};
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
  if (!job || job.expires_at <= Date.now())
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
        'UPDATE actions_runner_jobs SET github_run_id=?,github_run_attempt=? WHERE id=? AND github_run_id IS NULL AND expires_at>? AND result IS NULL',
      )
      .bind(identity.runId, identity.runAttempt, job.id, Date.now())
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
      'UPDATE actions_runner_jobs SET result=?,result_hash=?,completed_at=? WHERE id=? AND github_run_id=? AND github_run_attempt=? AND result IS NULL AND expires_at>?',
    )
    .bind(
      redact(stored),
      await digest(redact(stored)),
      Date.now(),
      job.id,
      identity.runId,
      identity.runAttempt,
      Date.now(),
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
  const github = new GitHub(token);
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
  const body = canonical(request),
    hash = await digest(body),
    id = crypto.randomUUID();
  if (new TextEncoder().encode(body).length > 850000)
    throw new Error('ACTIONS_RUNNER_REQUEST_LIMIT');
  const expires = Date.now() + 12 * 60_000;
  await env.DB.prepare(
    'INSERT INTO actions_runner_jobs(id,run_id,request_hash,request,expires_at,synthetic) VALUES(?,?,?,?,?,?)',
  )
    .bind(id, request.runId, hash, body, expires, synthetic ? 1 : 0)
    .run();
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
  while (Date.now() < expires) {
    await assertCurrent();
    const job = await env.DB.prepare(
      'SELECT result FROM actions_runner_jobs WHERE id=?',
    )
      .bind(id)
      .first<{ result: string | null }>();
    if (job?.result)
      return validateRunnerResult(JSON.parse(job.result), request, hash);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('ACTIONS_RUNNER_QUEUE_TIMEOUT');
}
