import { it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const baseline = JSON.parse(
  readFileSync('docs/master-acceptance.json', 'utf8'),
);
function validate(edit: (data: typeof baseline) => void) {
  const data = structuredClone(baseline);
  edit(data);
  const dir = mkdtempSync(join(tmpdir(), 'judge-acceptance-'));
  try {
    const path = join(dir, 'ledger.json');
    writeFileSync(path, JSON.stringify(data));
    return spawnSync(
      process.execPath,
      ['scripts/acceptance-report.mjs', '--input', path, '--validate-only'],
      { encoding: 'utf8' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
it('rejects status inflation from source presence, missing evidence and placeholder audits', () => {
  expect(
    validate((d) => {
      d.sections[0].items[0].verification.method = 'SOURCE_INSPECTION';
    }).status,
  ).not.toBe(0);
  expect(
    validate((d) => {
      d.sections[0].items[0].evidence = [];
    }).status,
  ).not.toBe(0);
  expect(
    validate((d) => {
      d.sections[0].items[0].note =
        'Awaiting item-level acceptance audit; implementation alone is not proof.';
    }).status,
  ).not.toBe(0);
});
it('rejects missing or duplicate items and nonexistent local evidence', () => {
  expect(
    validate((d) => {
      d.sections[0].items.pop();
    }).status,
  ).not.toBe(0);
  expect(
    validate((d) => {
      d.sections[0].items[1].id = d.sections[0].items[0].id;
    }).status,
  ).not.toBe(0);
  expect(
    validate((d) => {
      d.sections[0].items[0].evidence = ['docs/does-not-exist.md'];
    }).status,
  ).not.toBe(0);
});
it('rejects invented IDs and rewritten requirements', () => {
  expect(
    validate((d) => {
      d.sections[0].items[0].id = '01.999';
    }).status,
  ).not.toBe(0);
  expect(
    validate((d) => {
      d.sections[0].items[0].requirement = 'Weaker substitute';
    }).status,
  ).not.toBe(0);
});
it('validates all 714 scoped entries without treating counts as launch approval', () => {
  const result = validate(() => {});
  expect(result.status).toBe(0);
  const totals = JSON.parse(result.stdout) as Record<string, number>;
  expect(Object.values(totals).reduce((a, b) => a + b, 0)).toBe(714);
  expect(totals.PARTIAL).toBeGreaterThan(0);
  expect(totals.NOT_IMPLEMENTED).toBeGreaterThan(0);
});
