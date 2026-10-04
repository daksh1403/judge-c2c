import { expect, it } from 'vitest';
import { demoContract } from '../src/demo';
import type { Context } from '../src/evaluate';
import type { Evidence } from '../src/domain';
import { buildEvaluationPlan } from '../src/evaluation-plan';
import { buildReviewContext } from '../src/review-context';

function fixture() {
  const contract = structuredClone(demoContract);
  const context: Context = {
    files: [
      {
        filename: 'server.ts',
        status: 'modified',
        additions: 2,
        deletions: 1,
        patch: '@@ -1 +1 @@\n-old\n+changed head',
      },
    ],
    sources: {
      'server.ts': {
        baseline: 'old implementation',
        head: 'changed implementation',
      },
    },
    pullRequest: {
      title: 'Implement scheduling',
      description: 'Observable design explanation.',
      head: 'b'.repeat(40),
    },
    commits: [{ sha: 'b'.repeat(40), message: 'Implement a bounded queue' }],
    environment: 'fixture',
    toolVersion: 'fixture',
    risk: [],
  };
  const evidence: Evidence[] = [
    {
      id: 'criterion-pass',
      kind: 'execution',
      criterionId: 'future-time',
      status: 'PASS',
      claim: 'Trusted case passed.',
    },
    {
      id: 'criterion-fail',
      kind: 'execution',
      criterionId: 'future-time',
      status: 'FAIL',
      claim: 'Conflicting trusted case failed.',
    },
    {
      id: 'policy-fail',
      kind: 'policy',
      status: 'FAIL',
      claim: 'Protected path changed.',
    },
    {
      id: 'source-context',
      kind: 'source',
      path: 'server.ts',
      status: 'UNVERIFIED',
      claim: 'Changed source is review context only.',
    },
  ];
  return {
    contract,
    context,
    evidence,
    plan: buildEvaluationPlan(contract, context),
  };
}

it('retains the full frozen contract and all conflicting criterion facts with selected citation bindings', () => {
  const f = fixture();
  const result = buildReviewContext(
    f.contract,
    f.context,
    f.evidence,
    f.plan,
    20_000,
  );
  const prompt = JSON.parse(result.prompt!);
  expect(prompt.contract).toEqual(f.contract);
  expect(prompt.baseline).toBe(f.contract.baseline);
  expect(prompt.head).toBe(f.context.pullRequest!.head);
  expect(prompt.evidence).toEqual(f.evidence);
  expect(prompt.citationGuide.criterionEvidence['future-time']).toEqual([
    'criterion-pass',
    'criterion-fail',
  ]);
  expect(prompt.citationGuide.sourceEvidence).toContainEqual({
    path: 'server.ts',
    evidenceId: 'source-context',
  });
  expect(prompt.sources['server.ts'].head).toBe('changed implementation');
  expect(result.reviewEvidence).toEqual(f.evidence);
});

it('blocks instead of trimming mandatory contract or authoritative failures', () => {
  const f = fixture();
  const result = buildReviewContext(
    f.contract,
    f.context,
    f.evidence,
    f.plan,
    10,
  );
  expect(result.prompt).toBeNull();
  expect(result.budget.blockedReason).toBe(
    'FROZEN_CONTRACT_AND_REQUIRED_EVIDENCE_EXCEED_BUDGET',
  );
  expect(result.reviewEvidence.map((item) => item.id)).toEqual([
    'criterion-pass',
    'criterion-fail',
    'policy-fail',
  ]);
  expect(f.contract.requirements).toHaveLength(2);
});

it('omits oversized optional evidence without truncating selected evidence claims', () => {
  const f = fixture();
  const large: Evidence = {
    id: 'huge-advisory',
    kind: 'diff',
    status: 'UNVERIFIED',
    claim: 'x'.repeat(100_000),
  };
  f.evidence.push(large);
  const result = buildReviewContext(
    f.contract,
    f.context,
    f.evidence,
    f.plan,
    15_000,
  );
  expect(result.prompt).not.toBeNull();
  expect(result.budget.omittedEvidenceIds).toContain(large.id);
  const prompt = JSON.parse(result.prompt!);
  expect(
    prompt.evidence.find((item: Evidence) => item.id === 'source-context')
      .claim,
  ).toBe(f.evidence[3]!.claim);
  expect(prompt.citationGuide.knownEvidenceIds).not.toContain(large.id);
});

it('measures final redacted canonical UTF8 bytes, accounts for input reserve and labels token estimates', () => {
  const f = fixture();
  f.context.pullRequest!.description = '多字节🚀'.repeat(400);
  f.context.sources['server.ts']!.head = 'const api_key = "abcdefghijklmnop";';
  const result = buildReviewContext(
    f.contract,
    f.context,
    f.evidence,
    f.plan,
    20_000,
    3000,
  );
  expect(result.prompt).not.toContain('abcdefghijklmnop');
  expect(result.prompt).toContain('[REDACTED]');
  expect(result.budget.contextBytes).toBe(
    new TextEncoder().encode(result.prompt!).length,
  );
  expect(
    result.budget.contextBytes + result.budget.reservedInputBytes,
  ).toBeLessThanOrEqual(20_000);
  expect(result.budget.estimatedInputTokens).toBe(
    Math.ceil((result.budget.contextBytes + 3000) / 4),
  );
  expect(result.budget.inputTokenEstimateMethod).toContain('estimate only');
  expect(result.budget.reservedOutputTokens).toBe(4096);
});

it('discloses omitted paths and partial excerpts while bounding metadata and commit prose', () => {
  const f = fixture();
  f.plan.maxChangedFiles = 1;
  f.context.files.push({
    filename: 'other.ts',
    status: 'modified',
    additions: 1,
    deletions: 0,
    patch: 'other patch',
  });
  f.context.sources['other.ts'] = { baseline: 'old', head: 'new' };
  f.context.files[0]!.patch = 'diff '.repeat(1000);
  f.context.sources['server.ts']!.head = 'head '.repeat(1000);
  f.context.commits = Array.from({ length: 5 }, (_, index) => ({
    sha: String(index).repeat(40),
    message: 'message '.repeat(100),
  }));
  const result = buildReviewContext(
    f.contract,
    f.context,
    f.evidence,
    f.plan,
    20_000,
  );
  const prompt = JSON.parse(result.prompt!);
  expect(prompt.files).toHaveLength(1);
  expect(prompt.commits).toHaveLength(3);
  expect(
    prompt.commits.every(
      (commit: { message: string }) => commit.message.length <= 300,
    ),
  ).toBe(true);
  expect(prompt.omissions.omittedCommits).toBe(2);
  expect(prompt.omissions.truncatedCommitMessages).toBe(3);
  expect(prompt.omissions.truncatedDiffPaths).toContain('server.ts');
  expect(result.budget.omittedDiffPaths).toContain('other.ts');
  expect(result.budget.omittedSourcePaths).toContain('server.ts');
});

it('rejects invalid/reserved budgets and leaves all input objects unchanged', () => {
  const f = fixture(),
    before = JSON.stringify(f);
  for (const [max, reserved] of [
    [0, 0],
    [20_000, -1],
    [20_000, 20_000],
  ]) {
    expect(
      buildReviewContext(
        f.contract,
        f.context,
        f.evidence,
        f.plan,
        max,
        reserved,
      ).prompt,
    ).toBeNull();
  }
  buildReviewContext(f.contract, f.context, f.evidence, f.plan, 20_000);
  expect(JSON.stringify(f)).toBe(before);
});

it('progressively reads only known source citations with exact line and UTF8 budgets', async () => {
  const { retrieveReviewContext } = await import('../src/review-context');
  const f = fixture();
  f.context.sources['server.ts']!.head =
    'first\n多字节🚀\nconst api_key = "abcdefghijklmnop";';
  const result = retrieveReviewContext(
    f.context,
    f.evidence,
    [
      { path: 'server.ts', side: 'head', startLine: 2, lineCount: 2 },
      { path: '../../secret', side: 'head', startLine: 1, lineCount: 2 },
      { path: 'server.ts', side: 'head', startLine: 0, lineCount: 2 },
      { path: 'server.ts', side: 'head', startLine: 1, lineCount: 81 },
      { path: 'server.ts', side: 'head', startLine: 1, lineCount: 1 },
    ],
    8000,
  );
  expect(result.snippets[0]).toMatchObject({
    path: 'server.ts',
    startLine: 2,
    evidenceIds: ['source-context'],
  });
  expect(result.snippets[0]!.text).toContain('多字节🚀');
  expect(result.snippets[0]!.text).not.toContain('abcdefghijklmnop');
  expect(result.log.map((l) => l.status)).toEqual([
    'READ',
    'DENIED',
    'DENIED',
    'DENIED',
  ]);
  expect(result.droppedRequests).toBe(1);
  expect(result.bytes).toBeLessThanOrEqual(result.maxBytes);
  expect(
    retrieveReviewContext(
      f.context,
      [],
      [{ path: 'server.ts', side: 'head', startLine: 1, lineCount: 1 }],
    ).log[0]!.status,
  ).toBe('DENIED');
  expect(
    retrieveReviewContext(
      f.context,
      f.evidence,
      [{ path: 'server.ts', side: 'head', startLine: 1, lineCount: 1 }],
      1,
    ).log[0]!.status,
  ).toBe('BUDGET_EXCEEDED');
});
