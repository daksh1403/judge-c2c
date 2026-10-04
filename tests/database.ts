import { readFileSync } from 'node:fs';
export async function migrate(
  db: D1Database,
  files = [
    '0001_foundation.sql',
    '0004_organization.sql',
    '0005_assignment_contract.sql',
    '0006_execution.sql',
    '0007_team_issue_workflow.sql',
    '0008_console_roles.sql',
    '0009_publication_recovery.sql',
    '0010_reviewer_capacity.sql',
    '0011_execution_cache.sql',
    '0012_artifact_store.sql',
    '0013_additional_contributions.sql',
    '0014_operational_telemetry.sql',
    '0015_submission_relations.sql',
    '0016_repository_context_indexes.sql',
    '0017_run_measurements.sql',
    '0018_confidential_security.sql',
    '0019_stacked_submission_relations.sql',
    '0020_runner_measurements.sql',
    '0021_console_identities.sql',
    '0022_stage_measurements.sql',
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
