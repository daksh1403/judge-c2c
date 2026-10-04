-- Security sessions deliberately have no organizer/judge privileges.
CREATE TABLE security_sessions(hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE confidential_security_reports(
 id TEXT PRIMARY KEY,
 repository_id INTEGER NOT NULL REFERENCES github_repositories(id),
 title TEXT NOT NULL,
 details TEXT NOT NULL,
 artifacts TEXT NOT NULL DEFAULT '[]',
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE confidential_security_reviews(
 id TEXT PRIMARY KEY,
 report_id TEXT NOT NULL REFERENCES confidential_security_reports(id),
 status TEXT NOT NULL CHECK(status IN('TRIAGED','NEEDS_INFORMATION','CONFIRMED','REJECTED','RESOLVED')),
 reason TEXT NOT NULL,
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER confidential_reports_no_update BEFORE UPDATE ON confidential_security_reports BEGIN SELECT RAISE(ABORT,'CONFIDENTIAL_REPORT_IMMUTABLE'); END;
CREATE TRIGGER confidential_reports_no_delete BEFORE DELETE ON confidential_security_reports BEGIN SELECT RAISE(ABORT,'CONFIDENTIAL_REPORT_IMMUTABLE'); END;
CREATE TRIGGER confidential_reviews_no_update BEFORE UPDATE ON confidential_security_reviews BEGIN SELECT RAISE(ABORT,'CONFIDENTIAL_REVIEW_IMMUTABLE'); END;
CREATE TRIGGER confidential_reviews_no_delete BEFORE DELETE ON confidential_security_reviews BEGIN SELECT RAISE(ABORT,'CONFIDENTIAL_REVIEW_IMMUTABLE'); END;
