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
  const parsed = eventSchema.safeParse(
    JSON.parse(new TextDecoder().decode(body)),
  );
  if (!parsed.success)
    return Response.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
  const p = parsed.data;
  if (!['opened', 'synchronize', 'reopened', 'closed'].includes(p.action))
    return Response.json({ status: 'ignored' }, { status: 202 });
  const repo = await env.DB.prepare(
    'SELECT r.*,c.document FROM repositories r JOIN contracts c ON c.hash=r.active_contract_hash WHERE r.id=?',
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
  const payloadHash = await digest(new TextDecoder().decode(body));
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
    'SELECT a.team_id,t.name AS team_name,a.issue_numbers,a.contract_hash FROM assignments a JOIN teams t ON t.id=a.team_id WHERE repository_id=? AND pr_number=?',
  )
    .bind(p.repository.id, pr.number)
    .first<{
      team_id: string;
      team_name: string;
      issue_numbers: string;
      contract_hash: string | null;
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
  const snapshot = canonical({ ...assignment, issue_numbers: issues });
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
  await env.DB.batch([
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
