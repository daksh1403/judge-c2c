import { z } from 'zod';
import type { Env } from './env';
import type { GitHub } from './github';
import { canonical } from './domain';
const name = z
  .string()
  .max(39)
  .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/);
export const retirementInput = z
  .object({
    confirmation: name,
    attestation: z.literal(true),
    replacement: z
      .object({
        organization: name,
        workspace: z
          .string()
          .min(1)
          .max(63)
          .regex(/^[a-z0-9-]+$/),
        origin: z.string().url().max(300),
        targetHash: z.string().regex(/^[a-f0-9]{64}$/),
        appId: z.number().int().positive(),
        installationId: z.number().int().positive(),
        verificationReference: z.string().regex(/^[a-f0-9]{32}$/),
        verifiedAt: z.string().datetime(),
        expiresAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();
interface Retirement {
  state: 'ACTIVE' | 'RETIRING' | 'RETIRED';
  replacement: string | null;
  authorized_by: string | null;
  authorized_at: string | null;
  retired_at: string | null;
  app_id: number | null;
  installation_id: number | null;
  error: string | null;
}
export async function retirementStatus(db: D1Database) {
  const row = await db
    .prepare('SELECT * FROM organization_retirement WHERE id=1')
    .first<Retirement>();
  return {
    state: row?.state ?? 'ACTIVE',
    replacement: row?.replacement ? JSON.parse(row.replacement) : null,
    authorizedBy: row?.authorized_by ?? null,
    authorizedAt: row?.authorized_at ?? null,
    retiredAt: row?.retired_at ?? null,
    error: row?.error ?? null,
    retryable: row?.state === 'RETIRING',
    archiveReadOnly: row?.state === 'RETIRING' || row?.state === 'RETIRED',
    verificationKind: 'ORGANIZER_ATTESTATION',
  };
}
export async function organizationActive(env: Env) {
  // Native evaluations may also bind ORG_DB: only the explicit evaluation scope is fenced.
  return (
    env.EVALUATION_DETAILS_KIND !== 'organization' ||
    (await retirementStatus(env.DB)).state === 'ACTIVE'
  );
}
export async function requireOrganizationActive(env: Env) {
  if (!(await organizationActive(env))) throw new Error('ORGANIZATION_RETIRED');
}
function identity(value: z.infer<typeof retirementInput>['replacement']) {
  const {
    verificationReference: _reference,
    verifiedAt: _at,
    expiresAt: _expires,
    ...target
  } = value;
  return canonical(target);
}
export async function retireOrganization(
  env: Env,
  raw: unknown,
  actor: string,
  old: { app_id: number; installation_id: number | null },
  application: () => Promise<GitHub>,
) {
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
  const parsed = retirementInput.safeParse(raw);
  if (!parsed.success)
    return json({ error: 'INVALID_RETIREMENT_REQUEST' }, 400);
  const { confirmation, replacement } = parsed.data;
  let origin: URL;
  try {
    origin = new URL(replacement.origin);
  } catch {
    return json({ error: 'INVALID_REPLACEMENT' }, 400);
  }
  if (
    confirmation !== env.ORG_NAME ||
    replacement.organization.toLowerCase() === env.ORG_NAME!.toLowerCase() ||
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.origin !== replacement.origin ||
    origin.origin === new URL(env.ORG_PUBLIC_ORIGIN!).origin ||
    replacement.appId === old.app_id ||
    replacement.installationId === old.installation_id
  )
    return json(
      { error: 'RETIREMENT_CONFIRMATION_OR_REPLACEMENT_MISMATCH' },
      400,
    );
  const db = env.ORG_DB!;
  // Fixtures and existing databases have an ACTIVE singleton; retain it after retries.
  await db
    .prepare('INSERT OR IGNORE INTO organization_retirement(id) VALUES(1)')
    .run();
  let row = (await db
    .prepare('SELECT * FROM organization_retirement WHERE id=1')
    .first<Retirement>())!;
  if (
    row.replacement &&
    identity(JSON.parse(row.replacement)) !== identity(replacement)
  )
    return json({ error: 'RETIREMENT_TARGET_IMMUTABLE' }, 409);
  if (row.state === 'RETIRED')
    return json({ retirement: await retirementStatus(db) });
  if (row.state === 'ACTIVE') {
    const at = Date.parse(replacement.verifiedAt),
      expires = Date.parse(replacement.expiresAt),
      now = Date.now();
    if (
      at > now + 30000 ||
      now - at > 900000 ||
      expires <= now ||
      expires - at > 900000 ||
      expires <= at
    )
      return json({ error: 'REPLACEMENT_VERIFICATION_STALE' }, 400);
    if (!old.installation_id) return json({ error: 'APP_NOT_INSTALLED' }, 409);
    await db.batch([
      db
        .prepare(
          "INSERT INTO audit(action,entity) SELECT ?,? FROM organization_retirement WHERE id=1 AND state='ACTIVE'",
        )
        .bind(
          'organization.retiring',
          canonical({
            actor,
            replacement,
            authorization: 'ORGANIZER_ATTESTATION',
          }),
        ),
      db
        .prepare(
          "UPDATE organization_retirement SET state='RETIRING',replacement=?,authorized_by=?,authorized_at=CURRENT_TIMESTAMP,app_id=?,installation_id=? WHERE id=1 AND state='ACTIVE'",
        )
        .bind(canonical(replacement), actor, old.app_id, old.installation_id),
      db.prepare('UPDATE github_repositories SET accessible=0'),
      db.prepare(
        "INSERT OR IGNORE INTO timeline(run_id,state,detail) SELECT id,'SUPERSEDED','Organization retirement: active work fenced; evidence retained' FROM evaluations WHERE state NOT IN ('COMPLETED','FAILED','SUPERSEDED')",
      ),
      db.prepare(
        "UPDATE evaluations SET state='SUPERSEDED',updated_at=CURRENT_TIMESTAMP WHERE state NOT IN ('COMPLETED','FAILED','SUPERSEDED')",
      ),
    ]);
    row = (await db
      .prepare('SELECT * FROM organization_retirement WHERE id=1')
      .first<Retirement>())!;
    // Concurrent first requests cannot change the winning frozen identity.
    if (identity(JSON.parse(row.replacement!)) !== identity(replacement))
      return json({ error: 'RETIREMENT_TARGET_IMMUTABLE' }, 409);
  }
  const lease = crypto.randomUUID();
  const locked = await db
    .prepare(
      "UPDATE organization_retirement SET lease=?,lease_until=? WHERE id=1 AND state='RETIRING' AND lease_until<?",
    )
    .bind(lease, Date.now() + 120000, Date.now())
    .run();
  if (!locked.meta.changes) {
    const current = await retirementStatus(db);
    return json(
      { retirement: current },
      current.state === 'RETIRED' ? 200 : 202,
    );
  }
  let error: string | null = null,
    removed = false;
  try {
    const app = await application();
    const details = await app.api<{
      id: number;
      owner: { login: string; type: string };
    }>('/app');
    if (
      details.id !== row.app_id ||
      details.owner.type !== 'Organization' ||
      details.owner.login.toLowerCase() !== env.ORG_NAME!.toLowerCase()
    )
      throw new Error('APP_IDENTITY_MISMATCH');
    const inspect = async () => {
      try {
        const installation = await app.api<{
          id: number;
          app_id: number;
          account: { login: string; type: string };
        }>(`/app/installations/${row.installation_id}`);
        if (
          installation.id !== row.installation_id ||
          installation.app_id !== row.app_id ||
          installation.account.type !== 'Organization' ||
          installation.account.login.toLowerCase() !==
            env.ORG_NAME!.toLowerCase()
        )
          throw new Error('INSTALLATION_MISMATCH');
        return true;
      } catch (e) {
        if (e instanceof Error && e.message === 'GITHUB_HTTP_404') return false;
        throw e;
      }
    };
    if (await inspect()) {
      await app.api(`/app/installations/${row.installation_id}`, {
        method: 'DELETE',
      });
      removed = !(await inspect());
    } else removed = true;
    if (!removed) error = 'UNINSTALL_PENDING';
  } catch (e) {
    error =
      e instanceof Error &&
      ['APP_IDENTITY_MISMATCH', 'INSTALLATION_MISMATCH'].includes(e.message)
        ? e.message
        : 'UNINSTALL_UNAVAILABLE';
  }
  const completedAt = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO audit(action,entity) SELECT ?,? FROM organization_retirement WHERE id=1 AND state='RETIRING' AND lease=? AND lease_until>=?",
      )
      .bind(
        removed ? 'organization.retired' : 'organization.retirement-pending',
        canonical({ actor, error, installationId: row.installation_id }),
        lease,
        completedAt,
      ),
    db
      .prepare(
        "UPDATE organization_retirement SET state=?,retired_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE retired_at END,error=?,lease=NULL,lease_until=0 WHERE id=1 AND state='RETIRING' AND lease=? AND lease_until>=?",
      )
      .bind(
        removed ? 'RETIRED' : 'RETIRING',
        Number(removed),
        error,
        lease,
        completedAt,
      ),
  ]);
  const final = await retirementStatus(db);
  return json({ retirement: final }, final.state === 'RETIRED' ? 200 : 202);
}
