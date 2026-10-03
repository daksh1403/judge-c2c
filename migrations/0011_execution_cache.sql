ALTER TABLE execution_results ADD COLUMN request TEXT;
ALTER TABLE execution_results ADD COLUMN origin_run_id TEXT;
ALTER TABLE execution_results ADD COLUMN origin_execution_id TEXT;
ALTER TABLE execution_results ADD COLUMN cache_key TEXT;
ALTER TABLE execution_results ADD COLUMN cache_status TEXT CHECK(cache_status IS NULL OR cache_status IN ('BYPASS','MISS','HIT'));

CREATE TABLE execution_cache (
  repository_id INTEGER NOT NULL REFERENCES repositories(id),
  cache_key TEXT NOT NULL CHECK(length(cache_key)=64),
  origin_run_id TEXT NOT NULL REFERENCES evaluations(id),
  origin_execution_id TEXT NOT NULL REFERENCES execution_results(id),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  result_hash TEXT NOT NULL CHECK(length(result_hash)=64),
  request TEXT NOT NULL CHECK(json_valid(request)),
  result TEXT NOT NULL CHECK(json_valid(result)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(repository_id,cache_key)
);
CREATE TRIGGER immutable_execution_cache_update BEFORE UPDATE ON execution_cache BEGIN SELECT RAISE(ABORT,'Execution cache entries are immutable'); END;
CREATE TRIGGER immutable_execution_cache_delete BEFORE DELETE ON execution_cache BEGIN SELECT RAISE(ABORT,'Execution cache entries are immutable'); END;
