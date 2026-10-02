import { expect, it } from 'vitest';
import { appAccess } from '../src/github-app-access';
const app = {
  id: 5154942,
  name: 'Judge-C2C Daksh-Codebase',
  slug: 'judge-c2c-daksh-codebase',
  owner: { login: 'Daksh-Codebase', type: 'Organization' },
};
it('shows the live display name and organization-owned App settings rather than personal settings', () => {
  expect(appAccess(app, 'Daksh-Codebase', 167005353)).toMatchObject({
    name: app.name,
    owner: 'Daksh-Codebase',
    settingsUrl:
      'https://github.com/organizations/Daksh-Codebase/settings/apps/judge-c2c-daksh-codebase',
    installationUrl:
      'https://github.com/organizations/Daksh-Codebase/settings/installations/167005353',
  });
});
it('supports a personally owned App without changing the installed organization', () => {
  expect(
    appAccess(
      { ...app, owner: { login: 'daksh1403', type: 'User' } },
      'Daksh-Codebase',
      167005353,
    ).settingsUrl,
  ).toBe('https://github.com/settings/apps/judge-c2c-daksh-codebase');
});
it('rejects malformed names used in settings paths', () => {
  expect(() =>
    appAccess({ ...app, slug: '../bad' }, 'Daksh-Codebase', 167005353),
  ).toThrow();
});
