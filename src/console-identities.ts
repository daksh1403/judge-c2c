import { z } from 'zod';
import { boundedBody } from './security';
import { digest, contractSchema, type Evidence } from './domain';
import { requirementOutcomes } from './requirement-assessment';
import type { Env } from './env';
export type ConsoleRole = 'organizer' | 'judge' | 'security' | 'participant';
export type ConsoleSession = {
  hash: string;
  role: ConsoleRole;
  identity_id: string | null;
  name: string;
  team_id: string | null;
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const eligible =
  "i.revoked_at IS NULL AND (i.role<>'participant' OR EXISTS(SELECT 1 FROM teams t WHERE t.id=i.team_id AND t.status='ACTIVE'))";
export async function credentialIdentity(env: Env, token: string) {
  return env
    .ORG_DB!.prepare(
      `SELECT i.id,i.role FROM console_identities i WHERE i.credential_hash=? AND ${eligible}`,
    )
    .bind(await digest(token))
    .first<{ id: string; role: ConsoleRole }>();
}
export const identitySessionQuery = `SELECT s.hash,i.role,i.id AS identity_id,i.name,i.team_id FROM console_identity_sessions s JOIN console_identities i ON i.id=s.identity_id WHERE s.hash=? AND s.expires_at>? AND ${eligible}`;
const identityInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    role: z.enum(['organizer', 'judge', 'security', 'participant']),
    teamId: z.string().min(1).max(80).optional(),
  })
  .strict();
export async function manageIdentities(
  request: Request,
  env: Env,
  session: ConsoleSession,
) {
  if (session.role !== 'organizer')
    return json({ error: 'ORGANIZER_REQUIRED' }, 403);
  const db = env.ORG_DB!,
    actor = 'organizer:' + (session.identity_id ?? session.hash);
  const path = new URL(request.url).pathname.replace(
    '/api/organization/identities',
    '',
  );
  try {
    if (!path && request.method === 'GET')
      return json({
        identities: (
          await db
            .prepare(
              'SELECT id,name,role,team_id,created_at,revoked_at FROM console_identities ORDER BY created_at DESC,id LIMIT 200',
            )
            .all()
        ).results,
      });
    if (!path && request.method === 'POST') {
      const data = identityInput.parse(
        JSON.parse(new TextDecoder().decode(await boundedBody(request, 4000))),
      );
      if (data.role === 'participant') {
        if (
          !data.teamId ||
          !(await db
            .prepare("SELECT id FROM teams WHERE id=? AND status='ACTIVE'")
            .bind(data.teamId)
            .first())
        )
          return json({ error: 'ACTIVE_TEAM_REQUIRED' }, 403);
      } else if (data.teamId)
        return json({ error: 'TEAM_SCOPE_NOT_ALLOWED' }, 400);
      const id = crypto.randomUUID();
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const credential = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      await db.batch([
        db
          .prepare(
            'INSERT INTO console_identities(id,name,role,team_id,credential_hash) VALUES(?,?,?,?,?)',
          )
          .bind(
            id,
            data.name,
            data.role,
            data.teamId ?? null,
            await digest(credential),
          ),
        db
          .prepare(
            "INSERT INTO audit(action,entity,actor,changes) VALUES('identity.created',?,?,?)",
          )
          .bind(
            id,
            actor,
            JSON.stringify({
              name: data.name,
              role: data.role,
              teamId: data.teamId ?? null,
            }),
          ),
      ]);
      return json(
        {
          id,
          name: data.name,
          role: data.role,
          teamId: data.teamId ?? null,
          credential,
        },
        201,
      );
    }
    const revoke = path.match(/^\/([a-f0-9-]{36})\/revoke$/);
    if (revoke && request.method === 'POST') {
      if (
        !(await db
          .prepare('SELECT id FROM console_identities WHERE id=?')
          .bind(revoke[1])
          .first())
      )
        return json({ error: 'NOT_FOUND' }, 404);
      await db.batch([
        db
          .prepare(
            'UPDATE console_identities SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND revoked_at IS NULL',
          )
          .bind(revoke[1]),
        db
          .prepare('DELETE FROM console_identity_sessions WHERE identity_id=?')
          .bind(revoke[1]),
        db
          .prepare(
            "INSERT INTO audit(action,entity,actor) VALUES('identity.revoked',?,?)",
          )
          .bind(revoke[1], actor),
      ]);
      return json({ id: revoke[1], revoked: true });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ error: 'INVALID_INPUT' }, 400);
    if (error instanceof Error && error.message === 'BODY_LIMIT')
      return json({ error: 'BODY_LIMIT' }, 413);
    return json({ error: 'IDENTITY_MANAGEMENT_UNAVAILABLE' }, 503);
  }
}
export async function participantConsole(
  request: Request,
  env: Env,
  session: ConsoleSession,
) {
  if (session.role !== 'participant' || !session.team_id)
    return json({ error: 'PARTICIPANT_REQUIRED' }, 403);
  if (request.method !== 'GET') return json({ error: 'READ_ONLY_SCOPE' }, 403);
  const db = env.ORG_DB!,
    path = new URL(request.url).pathname.replace(
      '/api/organization/participant',
      '',
    );
  if (!path) {
    const team = await db
      .prepare(
        "SELECT id,name,status FROM teams WHERE id=? AND status='ACTIVE'",
      )
      .bind(session.team_id)
      .first();
    if (!team) return json({ error: 'UNAUTHORIZED' }, 401);
    const submissions = (
      await db
        .prepare(
          'SELECT s.repository_id,s.pr_number,s.head_sha,s.latest_run_id,s.status,s.issue_numbers,s.github_updated_at,r.full_name FROM submissions s JOIN github_repositories r ON r.id=s.repository_id WHERE s.team_id=? ORDER BY s.github_updated_at DESC LIMIT 100',
        )
        .bind(session.team_id)
        .all()
    ).results;
    const evaluations = (
      await db
        .prepare(
          "SELECT e.id,e.repository_id,e.pr_number,e.head_sha,e.baseline_sha,e.state,e.ai_status,e.created_at FROM evaluations e JOIN submissions s ON s.repository_id=e.repository_id AND s.pr_number=e.pr_number WHERE s.team_id=? AND json_extract(e.assignment_snapshot,'$.team_id')=? ORDER BY e.created_at DESC,e.id LIMIT 100",
        )
        .bind(session.team_id, session.team_id)
        .all()
    ).results;
    return json({ team, submissions, evaluations });
  }
  const match = path.match(/^\/evaluations\/([a-f0-9]{64})$/);
  if (!match) return json({ error: 'NOT_FOUND' }, 404);
  const run = await db
    .prepare(
      "SELECT e.id,e.repository_id,e.pr_number,e.head_sha,e.baseline_sha,e.state,e.ai_status,e.contract_snapshot,e.evidence FROM evaluations e JOIN submissions s ON s.repository_id=e.repository_id AND s.pr_number=e.pr_number WHERE e.id=? AND s.team_id=? AND json_extract(e.assignment_snapshot,'$.team_id')=?",
    )
    .bind(match[1], session.team_id, session.team_id)
    .first<{
      id: string;
      repository_id: number;
      pr_number: number;
      head_sha: string;
      baseline_sha: string;
      state: string;
      ai_status: string | null;
      contract_snapshot: string;
      evidence: string | null;
    }>();
  if (!run) return json({ error: 'NOT_FOUND' }, 404);
  try {
    const contract = contractSchema.parse(JSON.parse(run.contract_snapshot));
    const evidence = JSON.parse(run.evidence ?? '[]') as Evidence[];
    return json({
      evaluation: {
        id: run.id,
        repositoryId: run.repository_id,
        prNumber: run.pr_number,
        headSha: run.head_sha,
        baselineSha: run.baseline_sha,
        state: run.state,
        aiStatus: run.ai_status,
      },
      requirements: requirementOutcomes(contract, evidence),
    });
  } catch {
    return json({ error: 'EVALUATION_UNAVAILABLE' }, 503);
  }
}
