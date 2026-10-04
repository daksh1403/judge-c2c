import { describe, expect, it } from 'vitest';
import { assessExpectedArtifacts } from '../src/expected-artifacts';
import type { ExpectedArtifact } from '../src/expected-artifacts';
import { MAX_ARTIFACT_BYTES } from '../src/artifact-store';

const now = 1_800_000_000_000;
const expected: ExpectedArtifact = {
  id: 'submission-log',
  kind: 'stdout',
  required: true,
};
const contract = { expectedArtifacts: [expected] };
function artifact(
  overrides: Partial<
    Parameters<typeof assessExpectedArtifacts>[1][number]
  > = {},
) {
  return {
    key: 'evaluations/run/stdout-submission-0/hash',
    kind: 'stdout-submission-0',
    status: 'STORED' as const,
    sha256: 'a'.repeat(64),
    bytes: 0,
    expires_at: now + 60_000,
    ...overrides,
  };
}

describe('expected artifact availability', () => {
  it('preserves legacy contracts without an artifact declaration', () => {
    expect(assessExpectedArtifacts({}, [artifact()], now)).toEqual([]);
  });
  it('projects every declaration with metadata-only status and evidence keys', () => {
    const report = artifact({ kind: 'report', key: 'report-key' });
    const result = assessExpectedArtifacts(
      {
        expectedArtifacts: [
          expected,
          { id: 'report', kind: 'report', required: false },
        ],
      },
      [artifact(), artifact(), report],
      now,
    );
    expect(
      result.map((assessment) => [
        assessment.id,
        assessment.status,
        assessment.evidenceKeys,
      ]),
    ).toEqual([
      ['submission-log', 'PASS', [artifact().key]],
      ['report', 'PASS', ['report-key']],
    ]);
    expect(result[0]?.reason).toContain('integrity have not been verified');
    expect(result[0]?.reason).toContain('not proof of criterion correctness');
  });
  it('does not use baseline streams or generic execution records as submission evidence', () => {
    expect(
      assessExpectedArtifacts(
        contract,
        [artifact({ kind: 'stdout-baseline-0' })],
        now,
      )[0]?.status,
    ).toBe('UNVERIFIED');
    expect(
      assessExpectedArtifacts(
        { expectedArtifacts: [{ id: 'tests', kind: 'tests', required: true }] },
        [artifact({ kind: 'execution-submission-0' })],
        now,
      )[0]?.status,
    ).toBe('UNVERIFIED');
  });
  it('leaves missing, pending and deleted metadata unverified', () => {
    for (const metadata of [
      [],
      [artifact({ status: 'PENDING' })],
      [artifact({ status: 'DELETED' })],
    ]) {
      expect(assessExpectedArtifacts(contract, metadata, now)[0]).toMatchObject(
        { status: 'UNVERIFIED', evidenceKeys: [] },
      );
    }
  });
  it('does not certify malformed hashes, byte lengths, keys or retention', () => {
    for (const invalid of [
      { sha256: 'invalid' },
      { bytes: -1 },
      { bytes: 0.5 },
      { bytes: MAX_ARTIFACT_BYTES + 1 },
      { expires_at: now },
      { expires_at: now - 1 },
      { expires_at: null },
      { expires_at: NaN },
      { key: '' },
      { key: 'x'.repeat(241) },
    ]) {
      expect(
        assessExpectedArtifacts(contract, [artifact(invalid)], now)[0],
      ).toMatchObject({ status: 'UNVERIFIED', evidenceKeys: [] });
    }
  });
  it('marks required capture failure as infrastructure failure without scoring authority', () => {
    const failed = artifact({ status: 'FAILED' });
    const assessment = assessExpectedArtifacts(contract, [failed], now)[0];
    expect(assessment).toMatchObject({ status: 'FAIL', evidenceKeys: [] });
    expect(assessment?.reason).toContain('infrastructure');
    expect(assessment?.reason).toContain(
      'does not establish a participant failure',
    );
    expect(
      assessExpectedArtifacts(
        { expectedArtifacts: [{ ...expected, required: false }] },
        [failed],
        now,
      )[0]?.status,
    ).toBe('UNVERIFIED');
    expect(
      assessExpectedArtifacts(
        contract,
        [artifact({ status: 'FAILED', expires_at: now })],
        now,
      )[0]?.status,
    ).toBe('UNVERIFIED');
  });
  it('prefers available evidence over older failed capture metadata and preserves inputs', () => {
    const metadata = [
      artifact({ status: 'FAILED' }),
      artifact({ key: 'z' }),
      artifact({ key: 'a' }),
    ];
    const original = structuredClone(metadata);
    expect(assessExpectedArtifacts(contract, metadata, now)[0]).toMatchObject({
      status: 'PASS',
      evidenceKeys: ['a', 'z'],
    });
    expect(metadata).toEqual(original);
    expect(contract.expectedArtifacts).toEqual([expected]);
  });
});
