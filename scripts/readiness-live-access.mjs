import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const origin =
  process.env.REVIEW_URL ??
  'https://feat-hackathon-readiness-judge-c2c.dakshx.workers.dev';
if (!/^https:\/\/[a-z0-9-]+-judge-c2c\.dakshx\.workers\.dev$/.test(origin))
  throw Error('Use an existing isolated Judge-C2C PR review URL');
const r = await fetch(origin + '/api/organization/login', {
  method: 'POST',
  headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({
    token: (await readFile('.wrangler/judge-access.txt', 'utf8')).trim(),
  }),
});
if (!r.ok) throw Error('Judge login ' + r.status);
const cookie = r.headers.get('set-cookie').split(';')[0];
const request = (path, method = 'GET') =>
  fetch(origin + '/api/organization/' + path, {
    method,
    headers: { origin, cookie, 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
const status = await request('status');
const identity = await status.json();
const overview = await request('manage/overview');
const counts = await overview.json();
const denied = await request('manage/teams', 'POST');
const id = '6b15772153dc2c2058281a7c2249fd79957ec1da57bedf05b835cc277761ebd3';
const bundle = await request('evaluations/' + id + '/bundle');
const bytes = Buffer.from(await bundle.arrayBuffer());
const hash = createHash('sha256').update(bytes).digest('hex');
const exported = JSON.parse(bytes.toString());
const unauth = await fetch(
  origin + '/api/organization/evaluations/' + id + '/bundle',
);
const result = {
  mode: 'REAL_DEPLOYED_API_NO_FIXTURES',
  at: new Date().toISOString(),
  role: identity.role,
  overviewStatus: overview.status,
  counts: counts.counts ?? counts,
  writeDenied: denied.status,
  bundleStatus: bundle.status,
  bundleIntegrity: bundle.headers.get('x-evidence-sha256') === hash,
  bundleHead: exported.evaluation?.head_sha,
  unauthorizedBundle: unauth.status,
};
console.log(JSON.stringify(result));
await writeFile(
  'docs/qa/readiness-live-access.json',
  JSON.stringify(result, null, 2) + '\n',
);
await request('logout', 'POST');
if (
  denied.status !== 403 ||
  bundle.status !== 200 ||
  unauth.status !== 401 ||
  !result.bundleIntegrity ||
  result.bundleHead !== '749b414d1036a0c1b734af807e681e4894d2345e'
)
  throw Error('Role or export assertions failed');
