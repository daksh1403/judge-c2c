import { z } from 'zod';
import { sha, digest, type Evidence } from './domain';
import { GitHub, type ChangedFile } from './github';
import { classifyRisk, objective, type Context } from './evaluate';
import { redact } from './security';
import type { PreviewRequest, PreviewSnapshot } from './preview';

const repository = z.object({
  id: z.number().int().positive(),
  full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  private: z.literal(false),
});
const pull = z.object({
  number: z.number().int().positive(),
  title: z.string().max(1000),
  head: z.object({ sha }),
  base: z.object({ sha, repo: repository }),
});
const comparison = z.object({
  merge_base_commit: z.object({ sha }),
  files: z
    .array(
      z.object({
        filename: z.string().max(500),
        previous_filename: z.string().max(500).optional(),
        status: z.string().max(50),
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
        patch: z.string().optional(),
      }),
    )
    .max(100),
});
export async function preparePublicReview(
  github: GitHub,
  input: PreviewRequest,
): Promise<{ snapshot: PreviewSnapshot; files: ChangedFile[] }> {
  const parts = new URL(input.prUrl).pathname.split('/');
  const name = parts.slice(1, 3).join('/');
  const number = Number(parts[4]);
  const pr = pull.parse(await github.api(`/repos/${name}/pulls/${number}`));
  const initial = await github.api(
    `/repos/${name}/compare/${input.baseline ?? pr.base.sha}...${pr.head.sha}`,
  );
  return resolvePublicReview(input, pr, initial);
}
export function resolvePublicReview(
  input: PreviewRequest,
  prData: unknown,
  comparisonData: unknown,
): { snapshot: PreviewSnapshot; files: ChangedFile[] } {
  const parts = new URL(input.prUrl).pathname.split('/');
  const name = parts.slice(1, 3).join('/');
  const number = Number(parts[4]);
  const pr = pull.parse(prData);
  const initial = comparison.parse(comparisonData);
  if (
    pr.number !== number ||
    pr.base.repo.full_name.toLowerCase() !== name.toLowerCase()
  )
    throw new Error('PR_IDENTITY_MISMATCH');
  if (input.baseline && initial.merge_base_commit.sha !== input.baseline)
    throw new Error('BASELINE_NOT_ANCESTOR');
  return {
    snapshot: {
      schemaVersion: 1,
      evaluationVersion: 'public-review-v1',
      challengeVersion: 'review-session-v1',
      repository: { id: pr.base.repo.id, fullName: pr.base.repo.full_name },
      department: 'Public PR review',
      category: 'User-defined expectation',
      baseline: input.baseline ?? initial.merge_base_commit.sha,
      head: pr.head.sha,
      prNumber: number,
      prUrl: input.prUrl,
      prTitle: redact(pr.title),
      issueNumbers: [],
      baselineSource: input.baseline
        ? 'organizer-specified'
        : 'captured-pr-merge-base',
      requirements: [
        {
          id: 'review-expectation',
          title: 'Expected behavior',
          mandatory: true,
          criteria: [
            {
              id: 'expected-behavior',
              description: input.expectedBehavior,
              kind: 'functional',
              verification: { type: 'human' },
            },
            ...(input.sourceAssertion
              ? [
                  {
                    id: 'source-assertion',
                    description: `The file ${input.sourceAssertion.path} must contain the specified literal text. This verifies source presence only.`,
                    kind: 'source' as const,
                    verification: {
                      type: 'file_contains' as const,
                      ...input.sourceAssertion,
                    },
                  },
                ]
              : []),
          ],
        },
      ],
      constraints: [
        'Review-session expectations are supplied by the reviewer, never taken from participant code.',
        'Source presence does not establish functional correctness.',
        'No participant code is executed. No GitHub credentials or AI tools are used.',
      ],
      forbiddenPaths: input.protectedPaths,
      additionalCategories: [],
    },
    files: initial.files,
  };
}
export async function cachedPublicReview(
  db: D1Database,
  input: PreviewRequest,
) {
  const parts = new URL(input.prUrl).pathname.split('/');
  const row = await db
    .prepare(
      "SELECT document,sha256,captured_at FROM public_github_snapshots WHERE repository=? AND pr_number=? AND julianday(captured_at)>=julianday('now','-1 day') ORDER BY captured_at DESC LIMIT 1",
    )
    .bind(parts.slice(1, 3).join('/').toLowerCase(), Number(parts[4]))
    .first<{ document: string; sha256: string; captured_at: string }>();
  if (!row) return null;
  if ((await digest(row.document)) !== row.sha256)
    throw new Error('PUBLIC_SNAPSHOT_INTEGRITY');
  const data = JSON.parse(row.document);
  const result = resolvePublicReview(input, data.pr, data.comparison);
  result.snapshot.resolution = {
    source: 'frozen-github-cache',
    capturedAt: row.captured_at,
    headRefresh: 'UNVERIFIED',
  };
  return result;
}
export function publicResolutionEvidence(
  snapshot: PreviewSnapshot,
): Evidence[] {
  return snapshot.resolution
    ? [
        {
          id: 'github-head-refresh',
          kind: 'policy',
          status: 'UNVERIFIED',
          claim: `Using an operator-prepared real GitHub snapshot captured ${snapshot.resolution.capturedAt}. The latest PR head could not be refreshed; this review evaluates only the displayed frozen commits.`,
        },
      ]
    : [];
}
export async function preparePublicSnapshot(
  github: GitHub,
  input: PreviewRequest,
): Promise<PreviewSnapshot> {
  return (await preparePublicReview(github, input)).snapshot;
}
export function publicDiffContext(
  files: ChangedFile[],
): Context & { evidenceStage: 'prepared' } {
  return {
    files: files.map((file) => ({
      ...file,
      patch: file.patch ? redact(file.patch).slice(0, 5000) : undefined,
      patchTruncated: !!file.patch && file.patch.length > 5000,
    })),
    sources: {},
    risk: classifyRisk(files),
    environment: 'public-github-api-no-execution',
    toolVersion: 'judge-c2c-public-review-v1',
    evidenceStage: 'prepared',
  };
}
export async function collectPublicEvidence(
  github: GitHub,
  snapshot: PreviewSnapshot,
  preparedFiles?: ChangedFile[],
) {
  let files = preparedFiles;
  if (!files) {
    const result = comparison.parse(
      await github.api(
        `/repos/${snapshot.repository.fullName}/compare/${snapshot.baseline}...${snapshot.head}`,
      ),
    );
    if (result.merge_base_commit.sha !== snapshot.baseline)
      throw new Error('BASELINE_NOT_ANCESTOR');
    files = result.files;
  }
  const sources: Context['sources'] = {};
  for (const criterion of snapshot.requirements.flatMap((r) => r.criteria)) {
    if (criterion.verification.type !== 'file_contains') continue;
    const path = criterion.verification.path;
    const [baseline, head] = await Promise.all([
      github.publicFile(
        snapshot.repository.fullName,
        snapshot.baseline,
        path,
        100_000,
      ),
      github.publicFile(
        snapshot.repository.fullName,
        snapshot.head,
        path,
        100_000,
      ),
    ]);
    sources[path] = { baseline, head };
  }
  const raw: Context = {
    files,
    sources,
    risk: classifyRisk(files),
    environment: 'public-github-api-no-execution',
    toolVersion: 'judge-c2c-public-review-v1',
  };
  const evidence: Evidence[] = [
    ...objective(snapshot, raw),
    ...publicResolutionEvidence(snapshot),
  ];
  const context = {
    ...raw,
    evidenceStage: 'objective',
    files: files.map((f) => ({
      ...f,
      patch: f.patch ? redact(f.patch).slice(0, 5000) : undefined,
      patchTruncated: f.patchTruncated || (!!f.patch && f.patch.length > 5000),
    })),
    sources: Object.fromEntries(
      await Promise.all(
        Object.entries(sources).map(async ([path, s]) => [
          path,
          {
            baselineHash: s.baseline === null ? null : await digest(s.baseline),
            headHash: s.head === null ? null : await digest(s.head),
            baselineAvailable: s.baseline !== null,
            headAvailable: s.head !== null,
          },
        ]),
      ),
    ),
  };
  return { context, evidence };
}
