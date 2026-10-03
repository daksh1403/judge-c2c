import { expect, it } from 'vitest';
import { compareSecretObservations } from '../src/secret-scanner';

it('keeps inherited token observations distinct from newly introduced ones', () => {
  const result = compareSecretObservations(
    'const old = "ghp_123456789012345678901234567890123456";',
    'const old = "ghp_123456789012345678901234567890123456";\nconst next = "github_pat_123456789012345678901234567890123456";',
  );
  expect(result).toContainEqual(
    expect.objectContaining({
      ruleId: 'github-token',
      baselineCount: 1,
      headCount: 2,
      introducedCount: 1,
      inheritedCount: 1,
      comparisonComplete: true,
      headLines: [1, 2],
    }),
  );
  expect(JSON.stringify(result)).not.toContain('ghp_');
  expect(JSON.stringify(result)).not.toContain('github_pat_');
});

it('recognizes AWS access key IDs, key assignments, and private key blocks by location only', () => {
  const result = compareSecretObservations(
    '',
    [
      'const aws = "ASIAABCDEFGHIJKLMNOP";',
      'aws_secret_access_key = "abc12345secret67890"',
      '-----BEGIN RSA PRIVATE KEY-----',
      'opaque-material-that-must-not-be-returned',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n'),
  );
  expect(result.map((finding) => finding.ruleId)).toEqual(
    expect.arrayContaining([
      'aws-access-key-id',
      'key-assignment',
      'private-key-block',
    ]),
  );
  expect(result.every((finding) => finding.comparisonComplete)).toBe(true);
  expect(JSON.stringify(result)).not.toContain('ABCDEFGHIJKLMNOP');
  expect(JSON.stringify(result)).not.toContain('abc12345secret67890');
  expect(JSON.stringify(result)).not.toContain('opaque-material');
});

it('does not attribute findings when either side is missing or bounded scan truncates', () => {
  const missing = compareSecretObservations(
    null,
    'const token = "gho_123456789012345678901234567890123456";',
  );
  expect(missing[0]).toMatchObject({
    introducedCount: null,
    inheritedCount: null,
    comparisonComplete: false,
  });

  const truncated = compareSecretObservations(
    `${'x'.repeat(100_000)}ghp_123456789012345678901234567890123456`,
    'const token = "ghp_123456789012345678901234567890123456";',
  );
  expect(truncated[0]).toMatchObject({
    introducedCount: null,
    inheritedCount: null,
    comparisonComplete: false,
  });
});
