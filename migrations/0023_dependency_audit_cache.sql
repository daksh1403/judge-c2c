CREATE TABLE dependency_audit_cache (
  repository_id INTEGER NOT NULL REFERENCES repositories(id),
  cache_key TEXT NOT NULL CHECK(length(cache_key)=64),
  origin_run_id TEXT NOT NULL REFERENCES evaluations(id),
  request TEXT NOT NULL CHECK(json_valid(request)),
  result TEXT NOT NULL CHECK(json_valid(result)),
  result_hash TEXT NOT NULL CHECK(length(result_hash)=64),
  queried_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>queried_at),
  PRIMARY KEY(repository_id,cache_key)
);
CREATE TRIGGER immutable_dependency_audit_cache_update BEFORE UPDATE ON dependency_audit_cache BEGIN SELECT RAISE(ABORT,'Dependency audit snapshots are immutable'); END;
CREATE TRIGGER immutable_dependency_audit_cache_delete BEFORE DELETE ON dependency_audit_cache BEGIN SELECT RAISE(ABORT,'Dependency audit snapshots are immutable'); END;
