import { z } from 'zod';
import { canonical, digest } from './domain';
import {
  competitionDB,
  eventSettings,
  selectedRepository,
  auditStatement,
  type CompetitionServices,
} from './competition-store';
import { syncIssue, queueIssueLabels, assignIssue } from './competition-issues';
import { resolveSubmission } from './competition-submissions';
import type { Env } from './env';
export const managementEventSchema = z
  .object({
    event: z.enum(['issues', 'pull_request', 'issue_comment']),
    action: z.string().max(80),
    installationId: z.number().int().positive(),
    repositoryId: z.number().int().positive(),
    number: z.number().int().positive(),
    sender: z.object({
      id: z.number().int().positive(),
      login: z.string().max(100),
      type: z.string().max(50),
    }),
    label: z.string().max(100).optional(),
    comment: z.string().max(2000).optional(),
  })
  .strict();
export async function receiveCompetitionEvent(
  env: Env,
  services: CompetitionServices,
  ctx: ExecutionContext,
  event: string,
  payload: unknown,
  delivery: string,
  hash: string,
) {
  const raw = z
    .object({
      action: z.string(),
      installation: z.object({ id: z.number().int().positive() }),
      repository: z.object({ id: z.number().int().positive() }),
      sender: z.object({
        id: z.number().int().positive(),
        login: z.string(),
        type: z.string(),
      }),
      issue: z
        .object({
          number: z.number().int().positive(),
          pull_request: z.unknown().optional(),
        })
        .optional(),
      pull_request: z
        .object({ number: z.number().int().positive() })
        .optional(),
      label: z.object({ name: z.string() }).optional(),
      comment: z.object({ body: z.string() }).optional(),
    })
    .parse(payload);
  if (raw.installation.id !== (await services.installationId()))
    throw new Error('UNKNOWN_INSTALLATION');
  await selectedRepository(env, raw.repository.id);
  if (event === 'issues' && raw.issue?.pull_request)
    return { status: 'IGNORED' };
  if (
    event === 'issue_comment' &&
    (raw.issue?.pull_request ||
      raw.action !== 'created' ||
      raw.comment?.body.trim() !== '/judge claim')
  )
    return { status: 'IGNORED' };
  const number =
    event === 'pull_request' ? raw.pull_request?.number : raw.issue?.number;
  if (!number) throw new Error('INVALID_EVENT_CONTEXT');
  const normalized = managementEventSchema.parse({
    event,
    action: raw.action,
    installationId: raw.installation.id,
    repositoryId: raw.repository.id,
    number,
    sender: raw.sender,
    ...(raw.label ? { label: raw.label.name } : {}),
    ...(event === 'issue_comment' ? { comment: raw.comment?.body.trim() } : {}),
  });
  const db = competitionDB(env),
    old = await db
      .prepare('SELECT payload_hash FROM management_inbox WHERE id=?')
      .bind(delivery)
      .first<{ payload_hash: string }>();
  if (old) {
    if (old.payload_hash !== hash) throw new Error('DELIVERY_CONFLICT');
    return { status: 'DUPLICATE' };
  }
  await db
    .prepare(
      'INSERT OR IGNORE INTO management_inbox(id,payload_hash,event,document) VALUES(?,?,?,?)',
    )
    .bind(delivery, hash, event, canonical(normalized))
    .run();
  const storedDelivery = await db
    .prepare('SELECT payload_hash FROM management_inbox WHERE id=?')
    .bind(delivery)
    .first<{ payload_hash: string }>();
  if (storedDelivery?.payload_hash !== hash)
    throw new Error('DELIVERY_CONFLICT');
  ctx.waitUntil(
    processCompetitionDelivery(env, services, ctx, delivery).catch(() =>
      console.error(
        JSON.stringify({ event: 'management_delivery_deferred', delivery }),
      ),
    ),
  );
  return { status: 'QUEUED', delivery };
}
export async function processCompetitionDelivery(
  env: Env,
  services: CompetitionServices,
  ctx: ExecutionContext,
  id: string,
) {
  const db = competitionDB(env),
    lease = Date.now() + 120000;
  const claimed = await db
    .prepare(
      "UPDATE management_inbox SET status='PROCESSING',lease_until=?,attempts=attempts+1 WHERE id=? AND (status='PENDING' OR (status='PROCESSING' AND lease_until<?)) AND attempts<5 RETURNING document,payload_hash",
    )
    .bind(lease, id, Date.now())
    .first<{ document: string; payload_hash: string }>();
  if (!claimed) return;
  const event = managementEventSchema.parse(JSON.parse(claimed.document)),
    actor = 'github:' + event.sender.id;
  try {
    if (event.event === 'pull_request') {
      if (
        [
          'opened',
          'synchronize',
          'reopened',
          'closed',
          'edited',
          'ready_for_review',
          'converted_to_draft',
        ].includes(event.action)
      )
        await resolveSubmission(
          env,
          services,
          ctx,
          event.repositoryId,
          event.number,
          id,
          claimed.payload_hash,
          actor,
        );
    } else if (event.event === 'issue_comment') {
      const team = await db
        .prepare(
          "SELECT m.team_id FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.github_id=? AND m.active=1 AND t.status='ACTIVE' AND m.hackathon_id='initial'",
        )
        .bind(event.sender.id)
        .first<{ team_id: string }>();
      if (!team)
        await db
          .prepare(
            'INSERT INTO audit(action,entity,actor,changes) VALUES(?,?,?,?)',
          )
          .bind(
            'claim.denied',
            event.repositoryId + ':' + event.number,
            actor,
            canonical({ reason: 'Verified active team membership required' }),
          )
          .run();
      else
        try {
          await assignIssue(
            env,
            actor,
            {
              teamId: team.team_id,
              repositoryId: event.repositoryId,
              issueNumber: event.number,
            },
            'CLAIM',
          );
        } catch {
          await db
            .prepare(
              'INSERT INTO audit(action,entity,actor,changes) VALUES(?,?,?,?)',
            )
            .bind(
              'claim.denied',
              event.repositoryId + ':' + event.number,
              actor,
              canonical({ reason: 'Issue unavailable or team ineligible' }),
            )
            .run();
        }
    } else {
      await syncIssue(env, services, event.repositoryId, event.number, actor);
      const ownBot =
        event.sender.type === 'Bot' &&
        event.sender.login === (await services.appSlug()) + '[bot]';
      if (
        !ownBot &&
        event.label &&
        ['labeled', 'unlabeled'].includes(event.action) &&
        event.label.startsWith('judge:')
      ) {
        const row = await db
          .prepare(
            'SELECT overrides,classification FROM github_issues WHERE repository_id=? AND number=?',
          )
          .bind(event.repositoryId, event.number)
          .first<{ overrides: string; classification: string }>();
        if (row) {
          const overrides = JSON.parse(row.overrides),
            classification = JSON.parse(row.classification),
            [, dimension, value] = event.label.split(':');
          if (['type', 'priority', 'difficulty'].includes(dimension!))
            overrides[dimension!] = event.action === 'labeled' ? value : null;
          const suppressed = new Set<string>(overrides.suppressedLabels ?? []);
          if (event.action === 'unlabeled') suppressed.add(event.label);
          else suppressed.delete(event.label);
          overrides.suppressedLabels = [...suppressed];
          const humanLabels = new Set<string>(overrides.humanLabels ?? []);
          if (event.action === 'labeled') humanLabels.add(event.label);
          else humanLabels.delete(event.label);
          overrides.humanLabels = [...humanLabels];
          overrides.provenance = 'github-human';
          overrides.overrideActor = actor;
          await db.batch([
            db
              .prepare(
                'UPDATE github_issues SET overrides=?,classification=? WHERE repository_id=? AND number=?',
              )
              .bind(
                canonical(overrides),
                canonical({ ...classification, ...overrides }),
                event.repositoryId,
                event.number,
              ),
            auditStatement(
              env,
              actor,
              'issue.label.human-override',
              event.repositoryId + ':' + event.number,
              row,
              { action: event.action, label: event.label },
            ),
          ]);
          await queueIssueLabels(env, event.repositoryId, event.number);
        }
      }
    }
    await db
      .prepare(
        "UPDATE management_inbox SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP,lease_until=NULL,last_error=NULL WHERE id=? AND lease_until=?",
      )
      .bind(id, lease)
      .run();
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
        ? error.message
        : 'RECONCILIATION_UNAVAILABLE';
    await db
      .prepare(
        "UPDATE management_inbox SET status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,last_error=?,lease_until=NULL WHERE id=? AND lease_until=?",
      )
      .bind(code, id, lease)
      .run();
    throw new Error(code);
  }
}
export async function synchronizeLabels(
  env: Env,
  services: CompetitionServices,
  id: string,
) {
  const db = competitionDB(env),
    row = await db
      .prepare(
        "SELECT * FROM github_sync_actions WHERE id=? AND status='PENDING'",
      )
      .bind(id)
      .first<{
        repository_id: number;
        issue_number: number;
        document: string;
      }>();
  if (!row) return;
  const latest = await queueIssueLabels(
    env,
    row.repository_id,
    row.issue_number,
  );
  if (latest !== id) {
    await db
      .prepare("UPDATE github_sync_actions SET status='SUPERSEDED' WHERE id=?")
      .bind(id)
      .run();
    return;
  }
  const acquired = await db
    .prepare(
      "UPDATE github_sync_actions SET status='PROCESSING',attempts=attempts+1,lease_until=? WHERE id=? AND status='PENDING'",
    )
    .bind(Date.now() + 300000, id)
    .run();
  if (!acquired.meta.changes) return;
  try {
    const settings = await eventSettings(env),
      repo = await selectedRepository(env, row.repository_id),
      client = await services.client(row.repository_id, true);
    const labels = (JSON.parse(row.document).labels as string[]).filter(
      (name) => settings.taxonomy.some((l) => l.name === name),
    );
    const current = await db
      .prepare(
        'SELECT overrides FROM github_issues WHERE repository_id=? AND number=?',
      )
      .bind(row.repository_id, row.issue_number)
      .first<{ overrides: string }>();
    const suppressed =
      JSON.parse(current?.overrides ?? '{}').suppressedLabels ?? [];
    const desired = labels.filter((label) => !suppressed.includes(label));
    const native = await client.api<{ name: string }[]>(
      `/repos/${repo.full_name}/issues/${row.issue_number}/labels`,
    );
    const issueState = await db
      .prepare(
        'SELECT classification,overrides FROM github_issues WHERE repository_id=? AND number=?',
      )
      .bind(row.repository_id, row.issue_number)
      .first<{ classification: string; overrides: string }>();
    const previousApplied =
      JSON.parse(issueState?.classification ?? '{}').appliedLabels ?? [];
    const humanLabels =
      JSON.parse(issueState?.overrides ?? '{}').humanLabels ?? [];
    const obsolete = previousApplied.filter(
      (name: string) =>
        !desired.includes(name) &&
        !humanLabels.includes(name) &&
        native.some((label) => label.name === name),
    );
    for (const name of obsolete)
      await client.api(
        `/repos/${repo.full_name}/issues/${row.issue_number}/labels/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      );
    const missing = desired.filter(
      (name) => !native.some((label) => label.name === name),
    );
    if (missing.length) {
      const known = await client.api<{ name: string }[]>(
        `/repos/${repo.full_name}/labels?per_page=100`,
      );
      for (const name of missing) {
        if (known.some((label) => label.name === name)) continue;
        const definition = settings.taxonomy.find(
          (label) => label.name === name,
        )!;
        try {
          await client.api(`/repos/${repo.full_name}/labels`, {
            method: 'POST',
            body: canonical(definition),
          });
        } catch (error) {
          if (!(error instanceof Error && error.message === 'GITHUB_HTTP_422'))
            throw error;
          await client.api(
            `/repos/${repo.full_name}/labels/${encodeURIComponent(name)}`,
          );
        }
      }
      await client.api(
        `/repos/${repo.full_name}/issues/${row.issue_number}/labels`,
        { method: 'POST', body: canonical({ labels: missing }) },
      );
    }
    await db.batch([
      db
        .prepare(
          "UPDATE github_issues SET classification=json_set(classification,'$.appliedLabels',json(?)) WHERE repository_id=? AND number=?",
        )
        .bind(
          canonical([
            ...new Set([
              ...previousApplied.filter((n: string) => !obsolete.includes(n)),
              ...missing,
            ]),
          ]),
          row.repository_id,
          row.issue_number,
        ),
      db
        .prepare(
          "UPDATE github_sync_actions SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=?",
        )
        .bind(id),
      auditStatement(
        env,
        'automation',
        'issue.labels.synchronized',
        row.repository_id + ':' + row.issue_number,
        null,
        { labels: desired, added: missing },
      ),
    ]);
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
        ? error.message
        : 'LABEL_SYNC_UNAVAILABLE';
    await db
      .prepare(
        "UPDATE github_sync_actions SET status=CASE WHEN ? IN('GITHUB_HTTP_403','GITHUB_HTTP_422') THEN 'BLOCKED' WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,last_error=? WHERE id=?",
      )
      .bind(code, code, id)
      .run();
  }
}
export async function maintainCompetition(
  env: Env,
  services: CompetitionServices,
  ctx: ExecutionContext,
) {
  const db = competitionDB(env);
  await db
    .prepare(
      "UPDATE management_inbox SET status='FAILED',last_error='RETRY_EXHAUSTED_AFTER_CRASH',lease_until=NULL WHERE attempts>=5 AND (status='PENDING' OR (status='PROCESSING' AND lease_until<?))",
    )
    .bind(Date.now())
    .run();
  await db
    .prepare(
      "UPDATE issue_assignments SET status='EXPIRED',revoked_at=CURRENT_TIMESTAMP WHERE status IN('ACTIVE','RESERVED') AND expires_at IS NOT NULL AND datetime(expires_at)<=CURRENT_TIMESTAMP",
    )
    .run();
  // Processing label actions are safe to replay after a host failure: only missing labels are added.
  await db
    .prepare(
      "UPDATE github_sync_actions SET status='PENDING' WHERE status='PROCESSING' AND lease_until<?",
    )
    .bind(Date.now())
    .run();
  const inbox = await db
    .prepare(
      "SELECT id FROM management_inbox WHERE status='PENDING' OR (status='PROCESSING' AND lease_until<?) ORDER BY received_at LIMIT 5",
    )
    .bind(Date.now())
    .all<{ id: string }>();
  for (const row of inbox.results)
    await processCompetitionDelivery(env, services, ctx, row.id).catch(
      () => {},
    );
  const actions = await db
    .prepare(
      "SELECT id FROM github_sync_actions WHERE status='PENDING' ORDER BY created_at LIMIT 2",
    )
    .all<{ id: string }>();
  for (const row of actions.results)
    await synchronizeLabels(env, services, row.id);
}
export async function reconcileRepository(
  env: Env,
  services: CompetitionServices,
  ctx: ExecutionContext,
  id: number,
  page = 1,
) {
  const repo = await selectedRepository(env, id),
    client = await services.client(id),
    installationId = await services.installationId();
  const [issues, pulls] = await Promise.all([
    client.api<
      { number: number; pull_request?: unknown; updated_at: string }[]
    >(`/repos/${repo.full_name}/issues?state=all&per_page=50&page=${page}`),
    client.api<{ number: number; updated_at: string }[]>(
      `/repos/${repo.full_name}/pulls?state=all&per_page=50&page=${page}`,
    ),
  ]);
  const db = competitionDB(env),
    statements = [];
  for (const [event, rows] of [
    ['issues', issues.filter((i) => !i.pull_request)],
    ['pull_request', pulls],
  ] as const)
    for (const row of rows) {
      const document = managementEventSchema.parse({
          event,
          action: event === 'issues' ? 'edited' : 'synchronize',
          installationId,
          repositoryId: id,
          number: row.number,
          sender: { id: 1, login: 'reconciliation', type: 'System' },
        }),
        text = canonical(document),
        hash = await digest(text + '\n' + row.updated_at),
        delivery = 'reconcile-' + hash;
      statements.push(
        db
          .prepare(
            "INSERT INTO management_inbox(id,payload_hash,event,document) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=CASE WHEN management_inbox.status IN('FAILED','COMPLETED') THEN 'PENDING' ELSE management_inbox.status END,attempts=0",
          )
          .bind(delivery, hash, event, text),
      );
    }
  if (statements.length) await db.batch(statements);
  ctx.waitUntil(maintainCompetition(env, services, ctx));
  return {
    queued: statements.length,
    nextPage: issues.length === 50 || pulls.length === 50 ? page + 1 : null,
  };
}
