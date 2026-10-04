import { z } from 'zod';
import { canonical, digest, pathSchema, sha, type Contract } from './domain';
import { redact, boundedBody } from './security';
import type { Env } from './env';

export const previewRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    prUrl: z
      .string()
      .max(300)
      .transform((value) => value.trim())
      .refine(
        (value) =>
          /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*\/?$/.test(
            value,
          ),
        'Enter a public GitHub pull request URL',
      ),
    expectedBehavior: z.string().trim().min(10).max(2000),
    baseline: sha.optional(),
    sourceAssertion: z
      .object({ path: pathSchema, text: z.string().min(1).max(1000) })
      .strict()
      .optional(),
    protectedPaths: z.array(pathSchema).max(10).default([]),
  })
  .strict();
export type PreviewRequest = z.infer<typeof previewRequestSchema>;
export type PreviewSnapshot = {
  resolution?: {
    source: 'frozen-github-cache';
    capturedAt: string;
    headRefresh: 'UNVERIFIED';
  };
  schemaVersion: 1;
  evaluationVersion: string;
  challengeVersion: string;
  repository: { id: number; fullName: string };
  department: string;
  category: string;
  baseline: string;
  head: string;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  issueNumbers: number[];
  requirements: Contract['requirements'];
  constraints: string[];
  forbiddenPaths: string[];
  additionalCategories: string[];
  baselineSource: 'organizer-specified' | 'captured-pr-merge-base';
};
export interface PreviewRun {
  id: string;
  owner_hash: string;
  request_hash: string;
  request: string;
  snapshot: string | null;
  snapshot_hash: string | null;
  state: string;
  context: string | null;
  evidence: string | null;
  report: string | null;
  timeline: string;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}
export function previewEnabled(env: Env) {
  return (
    env.PREVIEW_TESTING === 'true' &&
    ['local', 'review'].includes(env.ENVIRONMENT)
  );
}
export function previewView(run: PreviewRun) {
  const c = run.snapshot ? (JSON.parse(run.snapshot) as PreviewSnapshot) : null;
  return {
    id: run.id,
    pr_number:
      c?.prNumber ??
      Number(new URL(JSON.parse(run.request).prUrl).pathname.split('/')[4]),
    head_sha: c?.head ?? 'pending',
    baseline_sha: c?.baseline ?? 'pending',
    contract_hash: run.snapshot_hash ?? run.request_hash,
    contract_snapshot: c ? run.snapshot : null,
    assignment_snapshot: canonical({
      team_id: 'preview-session',
      team_name: 'Your review session',
      issue_numbers: [],
    }),
    state: run.state,
    evidence: run.evidence,
    report: run.report,
    context: run.context,
    ai_status: 'NOT_RUN',
    publication_status: 'READ_ONLY_GITHUB',
    failure_code: run.failure_code,
    created_at: run.created_at,
    updated_at: run.updated_at,
    full_name:
      c?.repository.fullName ??
      new URL(JSON.parse(run.request).prUrl).pathname
        .split('/')
        .slice(1, 3)
        .join('/'),
    timeline: JSON.parse(run.timeline),
    artifacts: [],
    preview: true,
    request: JSON.parse(run.request),
  };
}
async function session(request: Request, env: Env) {
  const match = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)judge_preview=([a-f0-9]{64})(?:;|$)/);
  const token = match?.[1];
  if (token) {
    const hash = await digest(token);
    const found = await env.DB.prepare(
      'SELECT owner_hash FROM preview_sessions WHERE owner_hash=? AND expires_at>?',
    )
      .bind(hash, Date.now())
      .first<{ owner_hash: string }>();
    if (found) return { hash, cookie: null };
  }
  const fresh = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const hash = await digest(fresh);
  await env.DB.prepare(
    'INSERT INTO preview_sessions(owner_hash,expires_at) VALUES(?,?)',
  )
    .bind(hash, Date.now() + 24 * 60 * 60 * 1000)
    .run();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return {
    hash,
    cookie: `judge_preview=${fresh}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure}`,
  };
}
export async function dispatchPreview(env: Env, runId: string) {
  if (!env.PREVIEW_EVALUATOR)
    throw new Error('PREVIEW_WORKFLOW_NOT_CONFIGURED');
  const run = await env.DB.prepare(
    "SELECT id FROM preview_runs WHERE id=? AND state='QUEUED'",
  )
    .bind(runId)
    .first();
  if (!run) return;
  try {
    await env.PREVIEW_EVALUATOR.create({ id: runId, params: { runId } });
  } catch {
    await (await env.PREVIEW_EVALUATOR.get(runId)).status();
  }
  await env.DB.prepare(
    'UPDATE preview_runs SET dispatched_at=CURRENT_TIMESTAMP WHERE id=?',
  )
    .bind(runId)
    .run();
}
export async function reconcilePreview(env: Env) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE preview_runs SET state='FAILED',failure_code='WORKFLOW_TIMEOUT',timeline=json_insert(timeline,'$[#]',json_object('state','FAILED','detail','Workflow did not complete within the preview time budget','created_at',CURRENT_TIMESTAMP)),updated_at=CURRENT_TIMESTAMP WHERE state NOT IN ('COMPLETED','FAILED') AND created_at<datetime('now','-15 minutes')",
    ),
    env.DB.prepare(
      "DELETE FROM preview_runs WHERE created_at<datetime('now','-7 days')",
    ),
    env.DB.prepare(
      'DELETE FROM preview_sessions WHERE expires_at<? AND NOT EXISTS(SELECT 1 FROM preview_runs WHERE owner_hash=preview_sessions.owner_hash)',
    ).bind(Date.now()),
    env.DB.prepare('DELETE FROM preview_limits WHERE bucket<?').bind(
      `${Math.floor(Date.now() / 3600000) - 24}:`,
    ),
  ]);
  const runs = await env.DB.prepare(
    "SELECT id FROM preview_runs WHERE state='QUEUED' AND dispatched_at IS NULL LIMIT 10",
  ).all<{ id: string }>();
  await Promise.allSettled(runs.results.map((r) => dispatchPreview(env, r.id)));
}
export async function previewApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  if (!previewEnabled(env))
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  const url = new URL(request.url);
  const path = url.pathname;
  if (
    request.method !== 'GET' &&
    (request.headers.get('origin') !== url.origin ||
      request.headers.get('sec-fetch-site') === 'cross-site')
  )
    return Response.json({ error: 'SAME_ORIGIN_REQUIRED' }, { status: 403 });
  const s = await session(request, env);
  const json = (value: unknown, status = 200) =>
    Response.json(value, {
      status,
      headers: {
        'cache-control': 'no-store',
        ...(s.cookie ? { 'set-cookie': s.cookie } : {}),
      },
    });
  if (request.method === 'GET' && path === '/api/overview') {
    const runs = await env.DB.prepare(
      'SELECT * FROM preview_runs WHERE owner_hash=? ORDER BY created_at DESC LIMIT 50',
    )
      .bind(s.hash)
      .all<PreviewRun>();
    const mapped = runs.results.map(previewView);
    return json({
      demo: false,
      preview: true,
      counts: {
        repositories: new Set(mapped.map((r) => r.full_name)).size,
        teams: 0,
        openSubmissions: mapped.length,
        active: mapped.filter((r) => !['COMPLETED', 'FAILED'].includes(r.state))
          .length,
        completed: mapped.filter((r) => r.state === 'COMPLETED').length,
        failed: mapped.filter((r) => r.state === 'FAILED').length,
        attention: mapped.filter((r) =>
          ['COMPLETED', 'FAILED'].includes(r.state),
        ).length,
      },
      runs: mapped,
    });
  }
  const runMatch = path.match(/^\/api\/evaluations\/([a-f0-9]{64})$/);
  if (request.method === 'GET' && runMatch) {
    const run = await env.DB.prepare(
      'SELECT * FROM preview_runs WHERE id=? AND owner_hash=?',
    )
      .bind(runMatch[1], s.hash)
      .first<PreviewRun>();
    return run ? json(previewView(run)) : json({ error: 'NOT_FOUND' }, 404);
  }
  if (request.method === 'GET' && path === '/api/repositories') {
    const runs = await env.DB.prepare(
      'SELECT snapshot FROM preview_runs WHERE owner_hash=? AND snapshot IS NOT NULL',
    )
      .bind(s.hash)
      .all<{ snapshot: string }>();
    const repos = new Map<string, { full_name: string; document: string }>();
    for (const r of runs.results) {
      const c = JSON.parse(r.snapshot) as PreviewSnapshot;
      repos.set(c.repository.fullName, {
        full_name: c.repository.fullName,
        document: r.snapshot,
      });
    }
    return json({ repositories: [...repos.values()] });
  }
  if (request.method === 'POST' && path === '/api/preview/evaluations') {
    const input = previewRequestSchema.parse(
      JSON.parse(new TextDecoder().decode(await boundedBody(request, 16_000))),
    );
    const text = canonical(input);
    if (redact(text) !== text)
      return json(
        {
          error: 'SECRET_IN_INPUT',
          message: 'Remove credentials from review inputs.',
        },
        400,
      );
    const hash = await digest(text);
    const runId = await digest(s.hash + hash);
    const existing = await env.DB.prepare(
      'SELECT id FROM preview_runs WHERE id=? AND owner_hash=?',
    )
      .bind(runId, s.hash)
      .first();
    if (existing) return json({ runId, status: 'existing' }, 200);
    const ipHash = await digest(
      request.headers.get('cf-connecting-ip') ?? 'local',
    );
    const hour = Math.floor(Date.now() / 3600000);
    const bucket = `${hour}:${ipHash}`;
    const result = await env.DB.batch([
      env.DB.prepare(
        'INSERT OR IGNORE INTO preview_limits(bucket,count) VALUES(?,0)',
      ).bind(bucket),
      env.DB.prepare(
        "INSERT OR IGNORE INTO preview_runs(id,owner_hash,request_hash,request,timeline) SELECT ?,?,?,?,? WHERE (SELECT count FROM preview_limits WHERE bucket=?)<10 AND (SELECT count(*) FROM preview_runs WHERE owner_hash=? AND created_at>=datetime('now','-1 hour'))<10 AND (SELECT count(*) FROM preview_runs WHERE state NOT IN ('COMPLETED','FAILED'))<10 AND (SELECT count(*) FROM preview_runs WHERE created_at>=datetime('now','-1 hour'))<20",
      ).bind(
        runId,
        s.hash,
        hash,
        text,
        canonical([
          {
            state: 'QUEUED',
            detail: 'Real public PR review requested',
            created_at: new Date().toISOString(),
          },
        ]),
        bucket,
        s.hash,
      ),
      env.DB.prepare(
        'UPDATE preview_limits SET count=count+1 WHERE bucket=? AND changes()=1',
      ).bind(bucket),
    ]);
    if (!result[1]!.meta.changes) {
      const duplicate = await env.DB.prepare(
        'SELECT id FROM preview_runs WHERE id=? AND owner_hash=?',
      )
        .bind(runId, s.hash)
        .first();
      if (duplicate) return json({ runId, status: 'existing' }, 200);
      return json(
        {
          error: 'PREVIEW_LIMIT',
          message:
            'Preview capacity reached. Try again after an hour or inspect an existing run.',
        },
        429,
      );
    }
    ctx.waitUntil(
      dispatchPreview(env, runId).catch(() =>
        console.error(
          JSON.stringify({ event: 'preview_dispatch_deferred', runId }),
        ),
      ),
    );
    return json({ runId, status: 'queued' }, 202);
  }
  return json({ error: 'PREVIEW_ADMIN_DISABLED' }, 403);
}
