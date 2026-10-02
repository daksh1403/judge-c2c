import { z } from 'zod';
import {
  canonical,
  digest,
  evaluationIdentity,
  sha,
  type Contract,
} from './domain';
import { boundedBody, verifyWebhook } from './security';
import { dispatch } from './store';
import type { Env } from './env';

const eventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({
    id: z.number().int().positive(),
    full_name: z.string(),
  }),
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({ sha }),
    base: z.object({ repo: z.object({ id: z.number().int().positive() }) }),
    updated_at: z.string().datetime(),
    state: z.enum(['open', 'closed']),
  }),
});
export async function webhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  if (env.DEMO_MODE === 'true' || !env.GITHUB_WEBHOOK_SECRET)
    return Response.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 503 });
  const body = await boundedBody(request, 1_000_000);
  if (
    !(await verifyWebhook(
      body,
      request.headers.get('x-hub-signature-256'),
      env.GITHUB_WEBHOOK_SECRET,
    ))
  )
    return Response.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
  const delivery = request.headers.get('x-github-delivery');
  const event = request.headers.get('x-github-event');
  if (!delivery || !/^[a-zA-Z0-9-]{1,100}$/.test(delivery))
    return Response.json({ error: 'INVALID_DELIVERY' }, { status: 400 });
  if (event === 'ping') return Response.json({ status: 'ok' });
  if (event !== 'pull_request')
    return Response.json({ status: 'ignored' }, { status: 202 });
  return acceptPullRequest(
    JSON.parse(new TextDecoder().decode(body)),
    env,
    ctx,
    delivery,
    await digest(new TextDecoder().decode(body)),
  );
}
export async function acceptPullRequest(
  raw: unknown,
  env: Env,
  ctx: ExecutionContext,
  delivery: string,
  payloadHash: string,
) {
  const event = 'pull_request';
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success)
    return Response.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
  const p = parsed.data;
  if (!['opened', 'synchronize', 'reopened', 'closed'].includes(p.action))
    return Response.json({ status: 'ignored' }, { status: 202 });
  const repo = await env.DB.prepare(
    'SELECT r.* FROM repositories r WHERE r.id=?',
  )
    .bind(p.repository.id)
    .first<{
      installation_id: number;
      full_name: string;
      active_contract_hash: string;
      document: string;
    }>();
  if (
    !repo ||
    repo.installation_id !== p.installation.id ||
    repo.full_name !== p.repository.full_name ||
    p.pull_request.base.repo.id !== p.repository.id
  )
    return Response.json({ error: 'UNREGISTERED_REPOSITORY' }, { status: 403 });
  const old = await env.DB.prepare(
    'SELECT payload_hash FROM deliveries WHERE id=?',
  )
    .bind(delivery)
    .first<{ payload_hash: string }>();
  if (old)
    return Response.json(
      {
        status:
          old.payload_hash === payloadHash ? 'duplicate' : 'DELIVERY_CONFLICT',
      },
      { status: old.payload_hash === payloadHash ? 200 : 409 },
    );
  const pr = p.pull_request;
  if (p.action === 'closed') {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT OR IGNORE INTO deliveries(id,payload_hash,event) VALUES(?,?,?)',
      ).bind(delivery, payloadHash, event),
      env.DB.prepare(
        'UPDATE submissions SET closed=1,github_updated_at=? WHERE repository_id=? AND pr_number=? AND github_updated_at<=?',
      ).bind(pr.updated_at, p.repository.id, pr.number, pr.updated_at),
      env.DB.prepare(
        "UPDATE evaluations SET state='SUPERSEDED',updated_at=CURRENT_TIMESTAMP WHERE repository_id=? AND pr_number=? AND state NOT IN ('COMPLETED','FAILED','SUPERSEDED') AND EXISTS(SELECT 1 FROM submissions WHERE repository_id=? AND pr_number=? AND closed=1)",
      ).bind(p.repository.id, pr.number, p.repository.id, pr.number),
    ]);
    return Response.json({ status: 'closed' });
  }
  if (pr.state !== 'open')
    return Response.json({ error: 'INCONSISTENT_EVENT' }, { status: 400 });
  const assignment = await env.DB.prepare(
    "SELECT a.team_id,t.name AS team_name,a.issue_numbers,a.contract_hash,a.resolution_snapshot FROM assignments a JOIN teams t ON t.id=a.team_id WHERE repository_id=? AND pr_number=? AND t.status='ACTIVE'",
  )
    .bind(p.repository.id, pr.number)
    .first<{
      team_id: string;
      team_name: string;
      issue_numbers: string;
      contract_hash: string | null;
      resolution_snapshot: string | null;
    }>();
  if (!assignment)
    return Response.json({ error: 'ASSIGNMENT_REQUIRED' }, { status: 422 });
  const selected = await env.DB.prepare(
    'SELECT hash,document FROM contracts WHERE hash=? AND repository_id=?',
  )
    .bind(
      assignment.contract_hash ?? repo.active_contract_hash,
      p.repository.id,
    )
    .first<{ hash: string; document: string }>();
  if (!selected)
    return Response.json({ error: 'CONTRACT_NOT_FOUND' }, { status: 422 });
  const contract = JSON.parse(selected.document) as Contract;
  const issues = JSON.parse(assignment.issue_numbers) as number[];
  if (
    issues.length !== contract.issueNumbers.length ||
    issues.some((i) => !contract.issueNumbers.includes(i))
  )
    return Response.json(
      { error: 'ASSIGNMENT_CONTRACT_MISMATCH' },
      { status: 422 },
    );
  const resolution = assignment.resolution_snapshot
    ? JSON.parse(assignment.resolution_snapshot)
    : null;
  const semanticResolution = resolution
    ? Object.fromEntries(
        Object.entries(resolution).filter(
          ([key]) => key !== 'resolutionRevision',
        ),
      )
    : null;
  // A database concurrency revision is not a change to the submission being judged.
  const snapshot = canonical({
    ...assignment,
    issue_numbers: issues,
    resolution_snapshot: semanticResolution
      ? canonical(semanticResolution)
      : null,
  });
  const identity = await evaluationIdentity(
    p.repository.id,
    pr.number,
    pr.head.sha,
    selected.hash,
    await digest(snapshot),
  );
  const prior = await env.DB.prepare('SELECT state FROM evaluations WHERE id=?')
    .bind(identity)
    .first<{ state: string }>();
  // Reopening or returning to a superseded commit creates a fresh attempt without
  // reviving a terminal historical run. Repeated deliveries still resolve the same ID.
  const runId =
    prior?.state === 'SUPERSEDED'
      ? await digest(canonical({ identity, resubmittedAt: pr.updated_at }))
      : identity;
  const assignedIds = resolution ? canonical(resolution.assignmentIds) : null;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO audit(action,entity,actor) VALUES('intake.eligibility',CASE WHEN EXISTS(SELECT 1 FROM teams WHERE id=? AND status='ACTIVE') AND (? IS NULL OR (EXISTS(SELECT 1 FROM hackathons WHERE id='initial' AND status='ACTIVE') AND EXISTS(SELECT 1 FROM team_repositories WHERE team_id=? AND repository_id=? AND active=1) AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN issue_assignments a ON a.id=j.value LEFT JOIN github_issues i ON i.repository_id=a.repository_id AND i.number=a.issue_number WHERE a.id IS NULL OR a.status<>'ACTIVE' OR i.review_status IS NULL OR i.review_status<>'APPROVED' OR (a.expires_at IS NOT NULL AND datetime(a.expires_at)<=CURRENT_TIMESTAMP)) AND EXISTS(SELECT 1 FROM submissions WHERE repository_id=? AND pr_number=? AND head_sha=? AND status='VALID' AND github_updated_at=? AND resolution_revision=?))) THEN ? ELSE NULL END,'github')",
    ).bind(
      assignment.team_id,
      assignedIds,
      assignment.team_id,
      p.repository.id,
      assignedIds,
      p.repository.id,
      pr.number,
      pr.head.sha,
      pr.updated_at,
      resolution?.resolutionRevision ?? null,
      runId,
    ),
    env.DB.prepare(
      'INSERT OR IGNORE INTO deliveries(id,payload_hash,event) VALUES(?,?,?)',
    ).bind(delivery, payloadHash, event),
    env.DB.prepare(
      "INSERT OR IGNORE INTO evaluations(id,repository_id,pr_number,head_sha,baseline_sha,contract_hash,contract_snapshot,assignment_snapshot,state) VALUES(?,?,?,?,?,?,?,?,'QUEUED')",
    ).bind(
      runId,
      p.repository.id,
      pr.number,
      pr.head.sha,
      contract.baseline,
      selected.hash,
      selected.document,
      snapshot,
    ),
    env.DB.prepare(
      'INSERT INTO submissions(repository_id,pr_number,head_sha,latest_run_id,github_updated_at,closed) VALUES(?,?,?,?,?,0) ON CONFLICT(repository_id,pr_number) DO UPDATE SET head_sha=excluded.head_sha,latest_run_id=excluded.latest_run_id,github_updated_at=excluded.github_updated_at,closed=0 WHERE excluded.github_updated_at>=submissions.github_updated_at',
    ).bind(p.repository.id, pr.number, pr.head.sha, runId, pr.updated_at),
    env.DB.prepare(
      "UPDATE evaluations SET state='SUPERSEDED',updated_at=CURRENT_TIMESTAMP WHERE repository_id=? AND pr_number=? AND state NOT IN ('COMPLETED','FAILED','SUPERSEDED') AND id<>(SELECT latest_run_id FROM submissions WHERE repository_id=? AND pr_number=?)",
    ).bind(p.repository.id, pr.number, p.repository.id, pr.number),
    env.DB.prepare(
      "INSERT OR IGNORE INTO timeline(run_id,state,detail) SELECT id,state,'Replaced by a newer submission' FROM evaluations WHERE repository_id=? AND pr_number=? AND state='SUPERSEDED'",
    ).bind(p.repository.id, pr.number),
    env.DB.prepare(
      "INSERT OR IGNORE INTO outbox(run_id) SELECT id FROM evaluations WHERE id=? AND state='QUEUED'",
    ).bind(runId),
    env.DB.prepare(
      'INSERT OR IGNORE INTO timeline(run_id,state,detail) SELECT id,state,? FROM evaluations WHERE id=?',
    ).bind('GitHub delivery ' + delivery, runId),
  ]);
  ctx.waitUntil(
    dispatch(env, runId).catch(() =>
      console.error(JSON.stringify({ event: 'dispatch_deferred', runId })),
    ),
  );
  return Response.json({ status: 'accepted', runId }, { status: 202 });
}
