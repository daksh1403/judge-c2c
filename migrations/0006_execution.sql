CREATE TABLE execution_results (
 id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES evaluations(id),
 commit_sha TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 result_hash TEXT NOT NULL,
 result TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX execution_by_run ON execution_results(run_id,created_at);
CREATE TRIGGER immutable_execution BEFORE UPDATE ON execution_results BEGIN SELECT RAISE(ABORT,'Execution evidence is immutable'); END;
