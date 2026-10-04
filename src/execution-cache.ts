import { canonical, digest } from './domain';
import type { RunnerRequest, RunnerResult } from './runner';
import { RUNNER_VERSION } from './runner-policy';
import { redact } from './security';

export type SafeRunnerRequest = {
  schemaVersion: 1;
  runId: string;
  commit: string;
  contractHash: string;
  policyHash: string;
  timeoutSeconds: number;
  memoryMiB: number;
  files: { path: string; sha256: string; bytes: number }[];
};

export async function safeRunnerRequest(
  request: RunnerRequest,
): Promise<SafeRunnerRequest> {
  return {
    schemaVersion: 1,
    runId: request.runId,
    commit: request.commit,
    contractHash: request.contractHash,
    policyHash: await digest(canonical(request.policy)),
    timeoutSeconds: request.timeoutSeconds,
    memoryMiB: request.memoryMiB,
    files: await Promise.all(
      request.files.map(async ({ path, text }) => ({
        path,
        sha256: await digest(text),
        bytes: new TextEncoder().encode(text).length,
      })),
    ),
  };
}

export async function executionCacheKey(
  repositoryId: number,
  request: RunnerRequest,
  adapter: string,
  environment: string,
  imageDigest: string,
) {
  const snapshot = await safeRunnerRequest(request);
  return digest(
    canonical({
      schemaVersion: 1,
      repositoryId,
      commit: request.commit,
      contractHash: request.contractHash,
      policy: request.policy,
      policyHash: snapshot.policyHash,
      evaluatorVersion: RUNNER_VERSION,
      imageDigest,
      adapter,
      environment,
      timeoutSeconds: request.timeoutSeconds,
      memoryMiB: request.memoryMiB,
      files: snapshot.files,
    }),
  );
}

export function cacheableResult(
  result: RunnerResult,
  storedResult: string,
  timeoutSeconds: number,
) {
  return (
    redact(canonical(result)) === canonical(result) &&
    result.checks.length > 0 &&
    result.checks.every(
      (check) =>
        // A fresh benchmark must collect fresh timings. Only immutable setup
        // artefacts in the image are reusable, never historical measurements.
        check.kind !== 'benchmark' &&
        check.status !== 'UNVERIFIED' &&
        check.durationMs <= timeoutSeconds * 1000,
    ) &&
    new TextEncoder().encode(storedResult).length <= 512000
  );
}

export async function verifiedCacheEntry<
  T extends {
    request_hash: string;
    result_hash: string;
    result: string;
    request: string;
    cache_key: string;
  },
>(
  entry: T,
  expectedKey: string,
  request: RunnerRequest,
  validate: (
    result: unknown,
    request: RunnerRequest,
    requestHash: string,
  ) => RunnerResult,
) {
  try {
    if (
      entry.cache_key !== expectedKey ||
      (await digest(entry.result)) !== entry.result_hash
    )
      return null;
    const summary = JSON.parse(entry.request) as SafeRunnerRequest;
    if (summary.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(summary.runId))
      return null;
    const originalRequest = { ...request, runId: summary.runId };
    if (
      canonical(summary) !== canonical(await safeRunnerRequest(originalRequest))
    )
      return null;
    const requestHash = await digest(canonical(originalRequest));
    if (requestHash !== entry.request_hash) return null;
    const result = validate(
      JSON.parse(entry.result),
      originalRequest,
      entry.request_hash,
    );
    if (!cacheableResult(result, entry.result, request.timeoutSeconds))
      return null;
    return result;
  } catch {
    return null;
  }
}
