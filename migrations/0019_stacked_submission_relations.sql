DROP TRIGGER immutable_submission_relations_update;
DROP TRIGGER immutable_submission_relations_delete;
CREATE TABLE submission_relations_v2 (
 id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL,
 source_pr INTEGER NOT NULL CHECK(source_pr>0),
 target_pr INTEGER NOT NULL CHECK(target_pr>0 AND target_pr<>source_pr),
 kind TEXT NOT NULL CHECK(kind IN('ALTERNATE','DUPLICATE','SUPERSEDES','DEPENDS_ON')),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 20 AND 2000),
 actor TEXT NOT NULL CHECK(length(trim(actor)) BETWEEN 1 AND 160),
 request_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, team_id TEXT NOT NULL,
 source_head_sha TEXT, target_head_sha TEXT,
 issue_numbers TEXT NOT NULL CHECK(json_valid(issue_numbers)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(repository_id,source_pr) REFERENCES submissions(repository_id,pr_number),
 FOREIGN KEY(repository_id,target_pr) REFERENCES submissions(repository_id,pr_number)
);
INSERT INTO submission_relations_v2 SELECT r.id,r.repository_id,r.source_pr,r.target_pr,r.kind,r.reason,r.actor,r.request_id,r.request_hash,r.team_id,NULL,NULL,r.issue_numbers,r.created_at FROM submission_relations r JOIN submissions s ON s.repository_id=r.repository_id AND s.pr_number=r.source_pr JOIN submissions t ON t.repository_id=r.repository_id AND t.pr_number=r.target_pr;
DROP TABLE submission_relations;
ALTER TABLE submission_relations_v2 RENAME TO submission_relations;
CREATE INDEX submission_relations_source ON submission_relations(repository_id,source_pr);
CREATE INDEX submission_relations_target ON submission_relations(repository_id,target_pr);
CREATE TRIGGER immutable_submission_relations_update BEFORE UPDATE ON submission_relations
BEGIN SELECT RAISE(ABORT,'Submission relations are immutable'); END;
CREATE TRIGGER immutable_submission_relations_delete BEFORE DELETE ON submission_relations
BEGIN SELECT RAISE(ABORT,'Submission relations are immutable'); END;
