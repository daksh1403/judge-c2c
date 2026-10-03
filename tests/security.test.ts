import { expect, it } from 'vitest';
import { redact } from '../src/security';

it('redacts a private-key marker at JSON string EOF without consuming JSON syntax', () => {
  const input = '{"evidence":"-----BEGIN PRIVATE KEY----- secret-material"}';
  const output = redact(input);
  expect(JSON.parse(output)).toEqual({
    evidence: '[REDACTED PRIVATE KEY]',
  });
  expect(output).toContain('{"evidence":');
  expect(output).not.toContain('secret-material');
});

it('redacts JSON string values based on their sensitive property names', () => {
  const input =
    '{"password":"plain-long-secret","aws_secret_access_key":"another-plain-secret","note":"ordinary text"}';
  const output = redact(input);
  expect(JSON.parse(output)).toEqual({
    password: '[REDACTED]',
    aws_secret_access_key: '[REDACTED]',
    note: 'ordinary text',
  });
  expect(output).not.toContain('plain-long-secret');
  expect(output).not.toContain('another-plain-secret');
});

it('preserves unchanged JSON byte-for-byte and fails closed at excessive nesting', () => {
  const unchanged = '{"z":1,"a":{"keep":"ordinary text"}}';
  expect(redact(unchanged)).toBe(unchanged);

  const deeplyNested = `${'['.repeat(101)}{"token":"longcredentialvalue"}${']'.repeat(101)}`;
  const output = redact(deeplyNested);
  expect(JSON.parse(output)).toEqual({
    redacted: true,
    reason: 'JSON nesting limit exceeded',
  });
  expect(output).not.toContain('longcredentialvalue');
});

it('masks opposite quote characters inside quoted assignment values', () => {
  const doubleQuoted = `password="let's keep this credential"`;
  const singleQuoted = `client_secret='say "this credential" safely'`;
  const output = redact(`${doubleQuoted}\n${singleQuoted}`);
  expect(output).not.toContain("let's keep this credential");
  expect(output).not.toContain('say "this credential" safely');
  expect(output).toContain('password="[REDACTED]"');
  expect(output).toContain("client_secret='[REDACTED]'");
});
