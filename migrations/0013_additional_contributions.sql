CREATE TABLE additional_contributions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES evaluations(id),
  actor TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 20 AND 2000),
  paths TEXT NOT NULL CHECK(json_valid(paths)),
  evidence_ids TEXT NOT NULL CHECK(json_valid(evidence_ids)),
  criterion_ids TEXT NOT NULL CHECK(json_valid(criterion_ids)),
  verification_status TEXT NOT NULL CHECK(verification_status IN('VERIFIED','UNVERIFIED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX additional_contributions_by_run ON additional_contributions(run_id,created_at,id);
CREATE TRIGGER additional_contributions_limit BEFORE INSERT ON additional_contributions
WHEN (SELECT count(*) FROM additional_contributions WHERE run_id=NEW.run_id)>=20
BEGIN SELECT RAISE(ABORT,'Additional contribution limit reached'); END;
CREATE TRIGGER immutable_additional_contributions_update BEFORE UPDATE ON additional_contributions
BEGIN SELECT RAISE(ABORT,'Additional contribution candidates are immutable'); END;
CREATE TRIGGER immutable_additional_contributions_delete BEFORE DELETE ON additional_contributions
BEGIN SELECT RAISE(ABORT,'Additional contribution candidates are immutable'); END;

CREATE TABLE additional_contribution_decisions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  candidate_id TEXT NOT NULL REFERENCES additional_contributions(id),
  run_id TEXT NOT NULL REFERENCES evaluations(id),
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN('RECOGNIZED','REJECTED')),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=20),
  actor TEXT NOT NULL,
  evidence_snapshot TEXT NOT NULL CHECK(json_valid(evidence_snapshot)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX additional_contribution_decisions_latest ON additional_contribution_decisions(candidate_id,sequence DESC);
CREATE TRIGGER additional_contribution_decision_run BEFORE INSERT ON additional_contribution_decisions
WHEN NOT EXISTS(SELECT 1 FROM additional_contributions c WHERE c.id=NEW.candidate_id AND c.run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'Decision run does not match candidate run'); END;
CREATE TRIGGER immutable_additional_contribution_decisions_update BEFORE UPDATE ON additional_contribution_decisions
BEGIN SELECT RAISE(ABORT,'Additional contribution decisions are immutable'); END;
CREATE TRIGGER immutable_additional_contribution_decisions_delete BEFORE DELETE ON additional_contribution_decisions
BEGIN SELECT RAISE(ABORT,'Additional contribution decisions are immutable'); END;
