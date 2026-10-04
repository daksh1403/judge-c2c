import { z } from 'zod';
const slug = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/);
const metadata = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(200),
  slug,
  owner: z.object({ login: slug, type: z.enum(['Organization', 'User']) }),
});
export function appAccess(
  raw: unknown,
  organization: string,
  installationId: number,
) {
  const app = metadata.parse(raw);
  return {
    id: app.id,
    name: app.name,
    slug: app.slug,
    owner: app.owner.login,
    ownerType: app.owner.type,
    settingsUrl:
      app.owner.type === 'Organization'
        ? `https://github.com/organizations/${encodeURIComponent(app.owner.login)}/settings/apps/${encodeURIComponent(app.slug)}`
        : `https://github.com/settings/apps/${encodeURIComponent(app.slug)}`,
    installationUrl: `https://github.com/organizations/${encodeURIComponent(slug.parse(organization))}/settings/installations/${z.number().int().positive().parse(installationId)}`,
  };
}
