import { readFile, writeFile, access } from 'node:fs/promises';
import { z } from 'zod';
import { format } from 'prettier';
const item = z
  .object({
    id: z.string(),
    requirement: z.string().min(1),
    status: z.enum([
      'PASS',
      'PARTIAL',
      'FAIL',
      'BLOCKED',
      'NOT_IMPLEMENTED',
      'NOT_APPLICABLE',
      'UNVERIFIED',
    ]),
    evidence: z.array(z.string()),
    note: z
      .string()
      .min(1)
      .refine(
        (n) =>
          !/awaiting item-level acceptance audit|implementation alone is not proof/i.test(
            n,
          ),
        'Replace placeholder with an item-specific audit result',
      ),
    verification: z
      .object({
        method: z.enum([
          'FIXTURE_TEST',
          'LIVE_INTEGRATION',
          'LOCAL_EXECUTION',
          'SOURCE_INSPECTION',
          'NOT_RUN',
        ]),
        boundary: z.string().min(20),
      })
      .strict(),
  })
  .strict()
  .superRefine((i, c) => {
    if (
      i.status === 'PASS' &&
      (!i.evidence.length ||
        i.verification.method === 'NOT_RUN' ||
        i.verification.method === 'SOURCE_INSPECTION')
    )
      c.addIssue({
        code: 'custom',
        message:
          'PASS requires executed verification evidence, not source presence',
      });
  });
const schema = z
  .object({
    schemaVersion: z.literal(1),
    updated: z.string(),
    scope: z.string(),
    sections: z
      .array(
        z
          .object({ id: z.string(), title: z.string(), items: z.array(item) })
          .strict(),
      )
      .length(51),
  })
  .strict();
const inputIndex = process.argv.indexOf('--input');
const inputPath =
  inputIndex < 0 ? 'docs/master-acceptance.json' : process.argv[inputIndex + 1];
const data = schema.parse(JSON.parse(await readFile(inputPath, 'utf8')));
const ids = data.sections.flatMap((s) => s.items.map((i) => i.id));
const expected = JSON.parse(
  await readFile('docs/acceptance-requirements.json', 'utf8'),
);
const actual = data.sections.map((s) => ({
  id: s.id,
  title: s.title,
  items: s.items.map((i) => ({ id: i.id, requirement: i.requirement })),
}));
if (JSON.stringify(actual) !== JSON.stringify(expected))
  throw Error('Acceptance requirements differ from authoritative manifest');
if (ids.length !== 714 || new Set(ids).size !== ids.length)
  throw Error('Expected 714 unique acceptance IDs');
for (const section of data.sections)
  for (const i of section.items) {
    if (!i.id.startsWith(section.id + '.'))
      throw Error('Acceptance section mismatch: ' + i.id);
    for (const e of i.evidence)
      if (!/^https:\/\//.test(e)) await access(e.split('#')[0]);
  }
const totals = {};
for (const s of data.sections)
  for (const i of s.items) totals[i.status] = (totals[i.status] ?? 0) + 1;
if (process.argv.includes('--validate-only')) {
  console.log(JSON.stringify(totals));
  process.exit(0);
}
const rawMarkdown =
  '# Judge-C2C — Master Acceptance Checklist\n\nGenerated from `docs/master-acceptance.json`; edit the structured source and run\n`npm run acceptance:update`. A check means verified PASS with evidence, not merely\nimplemented code. All other states remain unchecked.\n\n' +
  'Counts: ' +
  Object.entries(totals)
    .map(([status, n]) => status + ' ' + n)
    .join(' · ') +
  '.\n\nPASS is scoped to the cited executed scenario. SOURCE_INSPECTION means code was inspected, not that runtime behavior was proven.\n\n' +
  data.scope +
  '\n\n' +
  data.sections
    .map(
      (s) =>
        '## ' +
        s.id +
        '. ' +
        s.title +
        '\n\n' +
        s.items
          .map(
            (i) =>
              '- [' +
              (i.status === 'PASS' ? 'x' : ' ') +
              '] **' +
              i.id +
              ' ' +
              i.requirement +
              '** — ' +
              i.status +
              '. ' +
              i.note +
              ' Verification: ' +
              i.verification.method +
              '. Boundary: ' +
              i.verification.boundary +
              (i.evidence.length
                ? ' Evidence: ' +
                  i.evidence.map((e) => '`' + e + '`').join(', ') +
                  '.'
                : ''),
          )
          .join('\n'),
    )
    .join('\n\n') +
  '\n\n## Final acceptance gates\n\n1. Organizer → teams → identities → repositories → official issues → labels → frozen requirements → assignments/claims → real PR → validated mapping → isolated baseline/head checks → contextual AI → evidence-backed report → exact-head GitHub Check → dashboard → audited completion.\n2. Participant → GitHub issue → identity/team attribution → classification/labels → duplicate/security/information triage → organizer approve/reject/duplicate/recognize/convert/assign.\n\nBoth gates require real GitHub evidence. Fixtures supplement them; they do not replace them.\n';
const markdown = await format(rawMarkdown, { parser: 'markdown' });
if (process.argv.includes('--check')) {
  if ((await readFile('docs/master-acceptance.md', 'utf8')) !== markdown)
    throw Error('Regenerate master acceptance checklist');
} else await writeFile('docs/master-acceptance.md', markdown);
console.log(
  `${ids.length} acceptance items across ${data.sections.length} sections validated.`,
);
