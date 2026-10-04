import { z } from 'zod';
import { boundedBody } from './security';
import type { Env } from './env';
const intake = z
  .object({
    repositoryId: z.number().int().positive(),
    title: z.string().trim().min(5).max(120),
    details: z.string().trim().min(20).max(20000),
    artifacts: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            content: z.string().min(1).max(20000),
          })
          .strict(),
      )
      .max(5)
      .default([]),
  })
  .strict();
const review = z
  .object({
    status: z.enum([
      'TRIAGED',
      'NEEDS_INFORMATION',
      'CONFIRMED',
      'REJECTED',
      'RESOLVED',
    ]),
    reason: z.string().trim().min(20).max(2000),
  })
  .strict();
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
// This store is never joined to ordinary issues, evidence, audit, or AI inputs.
export async function confidentialSecurity(
  request: Request,
  env: Env,
  actor: string,
) {
  if (!/^(organizer|security):/.test(actor))
    return json({ error: 'SECURITY_ACCESS_REQUIRED' }, 403);
  const path = new URL(request.url).pathname.replace(
    '/api/organization/security-reports',
    '',
  );
  const db = env.ORG_DB!;
  try {
    if (path === '' && request.method === 'GET')
      return json({
        reports: (
          await db
            .prepare(
              "SELECT r.id,r.repository_id,r.title,r.created_at,coalesce((SELECT status FROM confidential_security_reviews v WHERE v.report_id=r.id ORDER BY rowid DESC LIMIT 1),'RECEIVED') AS status FROM confidential_security_reports r ORDER BY r.created_at DESC,r.id LIMIT 100",
            )
            .all()
        ).results,
      });
    if (path === '' && request.method === 'POST') {
      const data = intake.parse(
        JSON.parse(
          new TextDecoder().decode(await boundedBody(request, 125000)),
        ),
      );
      if (
        !(await db
          .prepare(
            'SELECT id FROM github_repositories WHERE id=? AND accessible=1',
          )
          .bind(data.repositoryId)
          .first())
      )
        return json({ error: 'REPOSITORY_NOT_SELECTED' }, 403);
      const id = crypto.randomUUID();
      await db
        .prepare(
          'INSERT INTO confidential_security_reports(id,repository_id,title,details,artifacts,actor) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          id,
          data.repositoryId,
          data.title,
          data.details,
          JSON.stringify(data.artifacts),
          actor,
        )
        .run();
      return json({ id, status: 'RECEIVED' }, 201);
    }
    const match = path.match(/^\/([a-f0-9-]{36})(\/reviews)?$/);
    if (!match) return json({ error: 'NOT_FOUND' }, 404);
    const report = await db
      .prepare('SELECT * FROM confidential_security_reports WHERE id=?')
      .bind(match[1])
      .first<Record<string, unknown>>();
    if (!report) return json({ error: 'NOT_FOUND' }, 404);
    if (!match[2] && request.method === 'GET')
      return json({
        report: { ...report, artifacts: JSON.parse(String(report.artifacts)) },
        reviews: (
          await db
            .prepare(
              'SELECT * FROM confidential_security_reviews WHERE report_id=? ORDER BY rowid',
            )
            .bind(match[1])
            .all()
        ).results,
      });
    if (match[2] && request.method === 'POST') {
      const data = review.parse(
        JSON.parse(new TextDecoder().decode(await boundedBody(request, 10000))),
      );
      const id = crypto.randomUUID();
      await db
        .prepare(
          'INSERT INTO confidential_security_reviews(id,report_id,status,reason,actor) VALUES(?,?,?,?,?)',
        )
        .bind(id, match[1], data.status, data.reason, actor)
        .run();
      return json({ id, status: data.status }, 201);
    }
    return json({ error: 'NOT_FOUND' }, 404);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ error: 'INVALID_INPUT' }, 400);
    return json(
      {
        error:
          error instanceof Error && error.message === 'BODY_LIMIT'
            ? 'BODY_LIMIT'
            : 'SECURITY_REPORT_UNAVAILABLE',
      },
      error instanceof Error && error.message === 'BODY_LIMIT' ? 413 : 503,
    );
  }
}
