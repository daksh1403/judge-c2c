import { readFile, writeFile } from 'node:fs/promises';
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
    note: z.string().min(1),
  })
  .strict()
  .superRefine((i, c) => {
    if (i.status === 'PASS' && !i.evidence.length)
      c.addIssue({ code: 'custom', message: 'PASS requires evidence' });
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
const data = schema.parse(
  JSON.parse(await readFile('docs/master-acceptance.json', 'utf8')),
);
const ids = data.sections.flatMap((s) => s.items.map((i) => i.id));
if (new Set(ids).size !== ids.length) throw Error('Duplicate acceptance ID');
const rawMarkdown =
  '# Judge-C2C — Master Acceptance Checklist\n\nGenerated from `docs/master-acceptance.json`; edit the structured source and run\n`npm run acceptance:update`. A check means verified PASS with evidence, not merely\nimplemented code. All other states remain unchecked.\n\n' +
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
