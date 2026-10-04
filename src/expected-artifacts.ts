import { MAX_ARTIFACT_BYTES } from './artifact-store';
import type { ArtifactMetadata } from './artifact-store';

export type ExpectedArtifact = {
  id: string;
  kind:
    | 'stdout'
    | 'stderr'
    | 'tests'
    | 'coverage'
    | 'security'
    | 'benchmark'
    | 'report'
    | 'diff';
  required: boolean;
};
export type ExpectedArtifactAssessment = ExpectedArtifact & {
  status: 'PASS' | 'FAIL' | 'UNVERIFIED';
  evidenceKeys: string[];
  reason: string;
};
type ArtifactSummary = Pick<
  ArtifactMetadata,
  'key' | 'kind' | 'status' | 'sha256' | 'bytes' | 'expires_at'
>;

function matches(kind: ExpectedArtifact['kind'], actual: string) {
  // Baseline streams cannot establish that submission artifacts were captured.
  return (
    actual === kind ||
    ((kind === 'stdout' || kind === 'stderr') &&
      new RegExp('^' + kind + '-submission-[0-9]+$').test(actual)) ||
    (['tests', 'coverage', 'security', 'benchmark'].includes(kind) &&
      new RegExp('^' + kind + '-submission-[0-9]+-[0-9]+$').test(actual))
  );
}

/** Availability projection only: no downloads, integrity certification, or participant scoring. */
export function assessExpectedArtifacts(
  contract: { expectedArtifacts?: readonly ExpectedArtifact[] },
  metadata: readonly ArtifactSummary[],
  now = Date.now(),
): ExpectedArtifactAssessment[] {
  return (contract.expectedArtifacts ?? []).map((expected) => {
    const matching = metadata.filter((artifact) =>
      matches(expected.kind, artifact.kind),
    );
    const stored = matching.filter(
      (artifact) =>
        artifact.status === 'STORED' &&
        /^[a-f0-9]{64}$/.test(artifact.sha256) &&
        Number.isSafeInteger(artifact.bytes) &&
        artifact.bytes >= 0 &&
        artifact.bytes <= MAX_ARTIFACT_BYTES &&
        Number.isFinite(artifact.expires_at) &&
        artifact.expires_at! > now &&
        artifact.key.length > 0 &&
        artifact.key.length <= 240 &&
        !/[\x00-\x1f]/.test(artifact.key),
    );
    if (stored.length)
      return {
        ...expected,
        status: 'PASS' as const,
        evidenceKeys: [
          ...new Set(stored.map((artifact) => artifact.key)),
        ].sort(),
        reason:
          'Matching stored metadata is available within retention. Artifact bytes and integrity have not been verified; this is not proof of criterion correctness.',
      };
    const captureFailed = matching.some(
      (artifact) =>
        artifact.status === 'FAILED' &&
        Number.isFinite(artifact.expires_at) &&
        artifact.expires_at! > now,
    );
    if (expected.required && captureFailed)
      return {
        ...expected,
        status: 'FAIL' as const,
        evidenceKeys: [],
        reason:
          'Required artifact capture failed in infrastructure. This does not establish a participant failure or authorize a scoring penalty.',
      };
    return {
      ...expected,
      status: 'UNVERIFIED' as const,
      evidenceKeys: [],
      reason: captureFailed
        ? 'Optional artifact capture failed in infrastructure; availability remains unverified.'
        : matching.length
          ? 'Matching metadata is pending, expired, deleted, or invalid; artifact availability remains unverified.'
          : 'No matching artifact metadata is available; artifact availability remains unverified.',
    };
  });
}
