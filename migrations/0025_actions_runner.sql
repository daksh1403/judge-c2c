-- Append-only attempt identity. Source inputs are immutable, completion is single-assignment.
CREATE TABLE actions_runner_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  synthetic INTEGER NOT NULL DEFAULT 0 CHECK(synthetic IN (0,1)),
  github_run_id TEXT,
  github_run_attempt TEXT,
  result TEXT,
  result_hash TEXT,
  completed_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX actions_runner_jobs_run ON actions_runner_jobs(run_id);
CREATE TRIGGER actions_runner_inputs_immutable BEFORE UPDATE OF id,run_id,request_hash,request,expires_at,synthetic ON actions_runner_jobs
BEGIN SELECT RAISE(ABORT,'immutable runner attempt'); END;
CREATE TRIGGER actions_runner_results_immutable BEFORE UPDATE ON actions_runner_jobs
WHEN OLD.result IS NOT NULL
BEGIN SELECT RAISE(ABORT,'completed runner attempt'); END;
