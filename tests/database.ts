import { readFileSync } from 'node:fs';
export async function migrate(
  db: D1Database,
  files = [
    '0001_foundation.sql',
    '0004_organization.sql',
    '0005_assignment_contract.sql',
    '0006_execution.sql',
    '0007_team_issue_workflow.sql',
  ],
) {
  for (const file of files) {
    const source = readFileSync('migrations/' + file, 'utf8'),
      triggers = source.match(/CREATE TRIGGER[\s\S]*?END;/g) ?? [];
    const sql = source.replace(/CREATE TRIGGER[\s\S]*?END;/g, '');
    for (const statement of sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
    for (const trigger of triggers) await db.prepare(trigger).run();
  }
}
