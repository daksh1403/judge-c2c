CREATE TABLE console_identities (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN('organizer','judge','security','participant')),
 team_id TEXT REFERENCES teams(id),
 credential_hash TEXT NOT NULL UNIQUE CHECK(length(credential_hash)=64),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revoked_at TEXT,
 CHECK((role='participant' AND team_id IS NOT NULL) OR (role<>'participant' AND team_id IS NULL))
);
CREATE TABLE console_identity_sessions (
 hash TEXT PRIMARY KEY,
 identity_id TEXT NOT NULL REFERENCES console_identities(id),
 expires_at INTEGER NOT NULL
);
CREATE INDEX console_identity_sessions_identity ON console_identity_sessions(identity_id);
CREATE TRIGGER immutable_console_identity BEFORE UPDATE ON console_identities
WHEN NEW.id IS NOT OLD.id OR NEW.name IS NOT OLD.name OR NEW.role IS NOT OLD.role OR NEW.team_id IS NOT OLD.team_id OR NEW.credential_hash IS NOT OLD.credential_hash
BEGIN SELECT RAISE(ABORT,'CONSOLE_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER irrevocable_console_identity BEFORE UPDATE ON console_identities
WHEN OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at
BEGIN SELECT RAISE(ABORT,'CONSOLE_IDENTITY_REVOKED'); END;
