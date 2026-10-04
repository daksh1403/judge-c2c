CREATE TABLE repository_context_indexes (
 cache_key TEXT PRIMARY KEY CHECK(length(cache_key)=64),
 repository_id INTEGER NOT NULL,
 baseline_sha TEXT NOT NULL, head_sha TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_repository_context_indexes_update BEFORE UPDATE ON repository_context_indexes
BEGIN SELECT RAISE(ABORT,'Repository indexes are immutable'); END;
CREATE TRIGGER immutable_repository_context_indexes_delete BEFORE DELETE ON repository_context_indexes
BEGIN SELECT RAISE(ABORT,'Repository indexes are immutable'); END;
