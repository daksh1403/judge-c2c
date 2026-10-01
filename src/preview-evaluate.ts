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
export async function preparePublicSnapshot(
  github: GitHub,
  input: PreviewRequest,
): Promise<PreviewSnapshot> {
  const parts = new URL(input.prUrl).pathname.split('/');
  const name = parts.slice(1, 3).join('/');
  const number = Number(parts[4]);
  const pr = pull.parse(await github.api(`/repos/${name}/pulls/${number}`));
  if (
    pr.number !== number ||
    pr.base.repo.full_name.toLowerCase() !== name.toLowerCase()
  )
    throw new Error('PR_IDENTITY_MISMATCH');
  const initial = comparison.parse(
    await github.api(
      `/repos/${name}/compare/${input.baseline ?? pr.base.sha}...${pr.head.sha}`,
    ),
  );
  if (input.baseline && initial.merge_base_commit.sha !== input.baseline)
    throw new Error('BASELINE_NOT_ANCESTOR');
  return {
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
  };
}
export async function collectPublicEvidence(
  github: GitHub,
  snapshot: PreviewSnapshot,
) {
  const result = comparison.parse(
    await github.api(
      `/repos/${snapshot.repository.fullName}/compare/${snapshot.baseline}...${snapshot.head}`,
    ),
  );
  if (result.merge_base_commit.sha !== snapshot.baseline)
    throw new Error('BASELINE_NOT_ANCESTOR');
  const files: ChangedFile[] = result.files;
  const sources: Context['sources'] = {};
  for (const criterion of snapshot.requirements.flatMap((r) => r.criteria)) {
    if (criterion.verification.type !== 'file_contains') continue;
    const path = criterion.verification.path;
    const [baseline, head] = await Promise.all([
      github.file(
        snapshot.repository.fullName,
        snapshot.baseline,
        path,
        100_000,
      ),
      github.file(snapshot.repository.fullName, snapshot.head, path, 100_000),
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
  const evidence: Evidence[] = objective(snapshot, raw);
  const context = {
    ...raw,
    files: files.map((f) => ({
      ...f,
      patch: f.patch ? redact(f.patch).slice(0, 5000) : undefined,
      patchTruncated: !!f.patch && f.patch.length > 5000,
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
