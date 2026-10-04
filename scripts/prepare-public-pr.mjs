// Trusted operator preparation, never run participant code or use a personal token.
import { createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { redact } from '../src/security.ts';
const url = process.argv[2],
  remote = process.argv.includes('--remote');
if (
  !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*\/?$/.test(
    url ?? '',
  )
)
  throw new Error(
    'Usage: node scripts/prepare-public-pr.mjs https://github.com/owner/repo/pull/123 [--remote]',
  );
const parts = new URL(url).pathname.split('/'),
  repo = parts.slice(1, 3).join('/'),
  number = Number(parts[4]);
async function read(path) {
  const response = await fetch('https://api.github.com' + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(25000),
    headers: {
      'user-agent': 'Judge-C2C-public-preparation',
      'x-github-api-version': '2022-11-28',
      accept: 'application/vnd.github+json',
    },
  });
  if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 2000000) {
      await reader.cancel();
      throw new Error('BODY_LIMIT');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const raw = await read(`/repos/${repo}/pulls/${number}`);
if (
  raw.base.repo.private !== false ||
  raw.number !== number ||
  raw.base.repo.full_name.toLowerCase() !== repo.toLowerCase()
)
  throw new Error('PUBLIC_REPOSITORY_REQUIRED');
const cmp = await read(
  `/repos/${repo}/compare/${raw.base.sha}...${raw.head.sha}`,
);
if (
  !/^[a-f0-9]{40}$/.test(raw.head.sha) ||
  !/^[a-f0-9]{40}$/.test(cmp.merge_base_commit.sha) ||
  !cmp.files ||
  cmp.files.length > 100
)
  throw new Error('PUBLIC_DIFF_LIMIT');
const pr = {
  number,
  title: redact(raw.title),
  head: { sha: raw.head.sha },
  base: {
    sha: raw.base.sha,
    repo: {
      id: raw.base.repo.id,
      full_name: raw.base.repo.full_name,
      private: false,
    },
  },
};
const comparison = {
  merge_base_commit: { sha: cmp.merge_base_commit.sha },
  files: cmp.files.map(
    ({ filename, previous_filename, status, additions, deletions, patch }) => ({
      filename,
      previous_filename,
      status,
      additions,
      deletions,
      patch: patch ? redact(patch) : undefined,
    }),
  ),
};
const document = JSON.stringify({ pr, comparison }),
  sha256 = createHash('sha256').update(document).digest('hex');
const capturedAt = new Date().toISOString(),
  id = createHash('sha256')
    .update(repo.toLowerCase() + number + raw.head.sha + capturedAt)
    .digest('hex');
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const sql = `INSERT INTO public_github_snapshots(id,repository,pr_number,head_sha,document,sha256,captured_at) VALUES(${[id, repo.toLowerCase(), number, raw.head.sha, document, sha256, capturedAt].map(quote).join(',')});`;
await mkdir('.wrangler', { recursive: true });
const file = `.wrangler/public-pr-${id}.sql`;
await writeFile(file, sql, { mode: 0o600 });
try {
  const result = spawnSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--env',
      remote ? 'review' : 'local',
      remote ? '--remote' : '--local',
      '--file',
      file,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('PUBLIC_SNAPSHOT_WRITE_FAILED');
  console.log(
    JSON.stringify({
      repository: repo,
      pr: number,
      head: raw.head.sha,
      baseline: cmp.merge_base_commit.sha,
      capturedAt,
      sha256,
    }),
  );
} finally {
  await unlink(file);
}
