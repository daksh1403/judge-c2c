ALTER TABLE artifacts ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE artifacts ADD COLUMN storage TEXT NOT NULL DEFAULT 'R2' CHECK(storage IN('R2','KV'));
ALTER TABLE artifacts ADD COLUMN status TEXT NOT NULL DEFAULT 'STORED' CHECK(status IN('PENDING','STORED','FAILED','DELETED'));
ALTER TABLE artifacts ADD COLUMN expires_at INTEGER;
ALTER TABLE artifacts ADD COLUMN error_code TEXT;
ALTER TABLE artifacts ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE artifacts ADD COLUMN upload_token TEXT;
ALTER TABLE artifacts ADD COLUMN upload_lease_until INTEGER;
ALTER TABLE artifacts ADD COLUMN delete_token TEXT;
ALTER TABLE artifacts ADD COLUMN cleanup_after INTEGER;
CREATE TABLE artifact_attempts (
 id TEXT PRIMARY KEY, artifact_key TEXT NOT NULL REFERENCES artifacts(key),
 action TEXT NOT NULL CHECK(action IN('STORE','DELETE')),
 status TEXT NOT NULL CHECK(status IN('STARTED','SUCCEEDED','FAILED')),
 code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX artifact_retention ON artifacts(status,expires_at);
CREATE TRIGGER immutable_artifact_identity BEFORE UPDATE OF key,run_id,sha256,bytes,content_type,kind,storage,expires_at ON artifacts BEGIN SELECT RAISE(ABORT,'Artifact identity and retention are immutable'); END;
CREATE TRIGGER immutable_artifact_attempt BEFORE UPDATE ON artifact_attempts BEGIN SELECT RAISE(ABORT,'Artifact attempt history is immutable'); END;
