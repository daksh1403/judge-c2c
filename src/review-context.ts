import { canonical, type Contract, type Evidence } from './domain';
import type { Context } from './evaluate';
import type { EvaluationPlan } from './evaluation-plan';
import { redact } from './security';

export function buildReviewContext(
  contract: Contract,
  context: Context,
  evidence: Evidence[],
  plan: EvaluationPlan,
  maxContextBytes = plan.maxContextBytes,
  reservedInputBytes = 0,
  reservedOutputTokens = 4096,
) {
  const mandatory = (item: Evidence) =>
    !!item.criterionId || (item.kind === 'policy' && item.status === 'FAIL');
  const selected = evidence.filter(mandatory);
  const files: Omit<Context['files'][number], 'patch'>[] = [];
  const diffs: Record<string, { excerpt: string; truncated: boolean }> = {};
  const sources: Record<
    string,
    {
      head?: string | null;
      baseline?: string | null;
      headTruncated?: boolean;
      baselineTruncated?: boolean;
    }
  > = {};
  let pullRequest:
    { title: string; description: string; head: string } | undefined;
  let repositoryIntelligence: Context['repositoryIntelligence'];
  const commits: { sha: string; message: string }[] = [];
  const patchFiles = context.files.filter((file) => file.patch);
  const sourcePaths = Object.keys(context.sources).sort();
  const changed = new Set(context.files.map((file) => file.filename));
  const omissions = () => ({
    repositoryIndexOmitted:
      !!context.repositoryIntelligence && !repositoryIntelligence,
    evidenceIds: evidence
      .filter((item) => !selected.includes(item))
      .map((item) => item.id),
    sourcePaths: sourcePaths.filter((path) => !(path in sources)),
    diffPaths: patchFiles
      .filter((file) => !(file.filename in diffs))
      .map((file) => file.filename),
    filePaths: context.files
      .filter((file) => !files.some((kept) => kept.filename === file.filename))
      .map((file) => file.filename),
    truncatedSourcePaths: Object.keys(sources).filter(
      (path) =>
        sources[path]!.headTruncated || sources[path]!.baselineTruncated,
    ),
    omittedBaselinePaths: Object.keys(sources).filter(
      (path) => !('baseline' in sources[path]!),
    ),
    truncatedDiffPaths: Object.keys(diffs).filter(
      (path) => diffs[path]!.truncated,
    ),
    omittedCommits: Math.max(
      0,
      (context.commits?.length ?? 0) - commits.length,
    ),
    pullRequestTextOmitted: !!context.pullRequest && !pullRequest,
    pullRequestTextTruncated:
      !!pullRequest &&
      !!context.pullRequest &&
      (pullRequest.title.length < context.pullRequest.title.length ||
        pullRequest.description.length <
          context.pullRequest.description.length),
    truncatedCommitMessages: commits.filter(
      (commit) =>
        (context.commits?.find((original) => original.sha === commit.sha)
          ?.message.length ?? 0) > commit.message.length,
    ).length,
  });
  const serialize = () => {
    const omitted = omissions();
    return redact(
      canonical({
        evaluationPlan: plan,
        contract,
        baseline: contract.baseline,
        head: context.pullRequest?.head ?? null,
        environment: context.environment,
        toolVersion: context.toolVersion,
        evidence: selected,
        citationGuide: {
          knownEvidenceIds: selected.map((item) => item.id),
          criterionEvidence: Object.fromEntries(
            contract.requirements
              .flatMap((r) => r.criteria)
              .map((criterion) => [
                criterion.id,
                selected
                  .filter((item) => item.criterionId === criterion.id)
                  .map((item) => item.id),
              ]),
          ),
          sourceEvidence: selected
            .filter((item) => item.kind === 'source' && item.path)
            .map((item) => ({ path: item.path, evidenceId: item.id })),
        },
        repositoryIntelligence,
        pullRequest,
        commits,
        files,
        diffs,
        sources,
        omissions: {
          ...omitted,
          evidenceCount: omitted.evidenceIds.length,
          sourceCount: omitted.sourcePaths.length,
          diffCount: omitted.diffPaths.length,
          fileCount: omitted.filePaths.length,
        },
      }),
    );
  };
  const size = (text: string) => new TextEncoder().encode(text).length;
  const validBudget =
    Number.isSafeInteger(maxContextBytes) &&
    maxContextBytes > 0 &&
    Number.isSafeInteger(reservedInputBytes) &&
    reservedInputBytes >= 0;
  const available = maxContextBytes - reservedInputBytes;
  const fits = () => validBudget && size(serialize()) <= available;
  const finish = (blockedReason?: string) => {
    const text = serialize(),
      omitted = omissions(),
      contextBytes = size(text);
    return {
      prompt: blockedReason ? null : text,
      reviewEvidence: [...selected],
      budget: {
        version: 'bounded-review-context-v1' as const,
        contextBytes,
        maxContextBytes,
        reservedInputBytes,
        reservedOutputTokens,
        estimatedInputTokens: Math.ceil(
          (contextBytes + reservedInputBytes) / 4,
        ),
        inputTokenEstimateMethod:
          'UTF-8 byte count divided by four; estimate only',
        omittedEvidenceIds: omitted.evidenceIds,
        omittedSourcePaths: [
          ...new Set([
            ...omitted.sourcePaths,
            ...omitted.truncatedSourcePaths,
            ...omitted.omittedBaselinePaths,
          ]),
        ].sort(),
        omittedDiffPaths: [
          ...new Set([...omitted.diffPaths, ...omitted.truncatedDiffPaths]),
        ].sort(),
        ...(blockedReason ? { blockedReason } : {}),
      },
    };
  };
  if (!validBudget) return finish('INVALID_CONTEXT_BUDGET');
  if (!fits())
    return finish('FROZEN_CONTRACT_AND_REQUIRED_EVIDENCE_EXCEED_BUDGET');

  for (const file of context.files.slice(0, plan.maxChangedFiles)) {
    const { patch: _patch, ...metadata } = file;
    files.push(metadata);
    if (!fits()) files.pop();
  }
  if (context.pullRequest) {
    pullRequest = {
      head: context.pullRequest.head,
      title: context.pullRequest.title.slice(0, 300),
      description: context.pullRequest.description.slice(0, 1200),
    };
    if (!fits()) pullRequest = undefined;
  }
  for (const commit of (context.commits ?? []).slice(0, 3)) {
    commits.push({ sha: commit.sha, message: commit.message.slice(0, 300) });
    if (!fits()) commits.pop();
  }
  const priority = (item: Evidence) =>
    item.status === 'FAIL' ? 0 : item.kind === 'source' ? 1 : 2;
  for (const item of evidence
    .filter((item) => !mandatory(item))
    .sort((a, b) => priority(a) - priority(b))) {
    selected.push(item);
    if (!fits()) selected.pop();
  }
  repositoryIntelligence = context.repositoryIntelligence;
  if (!fits()) repositoryIntelligence = undefined;
  for (const file of patchFiles.slice(0, plan.maxChangedFiles)) {
    diffs[file.filename] = {
      excerpt: file.patch!.slice(0, 2000),
      truncated: !!file.patchTruncated || file.patch!.length > 2000,
    };
    if (!fits()) delete diffs[file.filename];
  }
  // Every changed head excerpt gets a chance before optional baseline excerpts.
  const candidates = [...changed]
    .filter((path) => path in context.sources)
    .slice(0, plan.maxChangedFiles);
  for (const path of candidates) {
    const head = context.sources[path]!.head;
    sources[path] = {
      head: head?.slice(0, 1500) ?? null,
      headTruncated: !!head && head.length > 1500,
    };
    if (!fits()) delete sources[path];
  }
  for (const path of candidates.filter((path) => path in sources)) {
    const baseline = context.sources[path]!.baseline;
    sources[path]!.baseline = baseline?.slice(0, 750) ?? null;
    sources[path]!.baselineTruncated = !!baseline && baseline.length > 750;
    if (!fits()) {
      delete sources[path]!.baseline;
      delete sources[path]!.baselineTruncated;
    }
  }
  return finish();
}

export type ReviewReadRequest = {
  path: string;
  side: 'head' | 'baseline';
  startLine: number;
  lineCount: number;
};

/** Allowlisted immutable in-memory reads. No filesystem, network, shell or model privileges. */
export function retrieveReviewContext(
  context: Context,
  evidence: Evidence[],
  requests: ReviewReadRequest[],
  maxBytes = 8000,
) {
  const encoder = new TextEncoder();
  const log: {
    path: string;
    side: string;
    startLine: number;
    lineCount: number;
    status: string;
    bytes: number;
  }[] = [];
  const snippets: {
    path: string;
    side: string;
    startLine: number;
    text: string;
    evidenceIds: string[];
  }[] = [];
  let bytes = 0;
  for (const request of requests.slice(0, 4)) {
    const ids = evidence
      .filter((e) => e.kind === 'source' && e.path === request.path)
      .map((e) => e.id);
    const valid =
      Object.hasOwn(context.sources, request.path) &&
      ids.length > 0 &&
      ['head', 'baseline'].includes(request.side) &&
      Number.isSafeInteger(request.startLine) &&
      request.startLine > 0 &&
      Number.isSafeInteger(request.lineCount) &&
      request.lineCount > 0 &&
      request.lineCount <= 80;
    const source = valid ? context.sources[request.path]![request.side] : null;
    const text =
      source === null
        ? ''
        : redact(
            source
              .split('\n')
              .slice(
                request.startLine - 1,
                request.startLine - 1 + request.lineCount,
              )
              .join('\n'),
          );
    const snippet = {
      path: request.path,
      side: request.side,
      startLine: request.startLine,
      text,
      evidenceIds: ids,
    };
    const size = encoder.encode(canonical(snippet)).length;
    const status = !valid
      ? 'DENIED'
      : source === null
        ? 'UNAVAILABLE'
        : bytes + size > maxBytes
          ? 'BUDGET_EXCEEDED'
          : 'READ';
    if (status === 'READ') {
      snippets.push(snippet);
      bytes += size;
    }
    log.push({
      path: request.path.slice(0, 500),
      side: request.side,
      startLine: request.startLine,
      lineCount: request.lineCount,
      status,
      bytes: status === 'READ' ? size : 0,
    });
  }
  return {
    version: 'bounded-source-read-v1',
    snippets,
    log,
    bytes,
    maxBytes,
    maxReads: 4,
    droppedRequests: Math.max(0, requests.length - 4),
  };
}
