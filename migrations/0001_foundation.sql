PRAGMA foreign_keys = ON;
CREATE TABLE repositories (
  id INTEGER PRIMARY KEY, full_name TEXT NOT NULL UNIQUE, installation_id INTEGER NOT NULL,
  active_contract_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE contracts (
  hash TEXT PRIMARY KEY, repository_id INTEGER NOT NULL REFERENCES repositories(id),
  document TEXT NOT NULL CHECK(json_valid(document)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE assignments (
  repository_id INTEGER NOT NULL REFERENCES repositories(id), pr_number INTEGER NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id), issue_numbers TEXT NOT NULL CHECK(json_valid(issue_numbers)),
  PRIMARY KEY(repository_id, pr_number)
);
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, event TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE submissions (
  repository_id INTEGER NOT NULL REFERENCES repositories(id), pr_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL, latest_run_id TEXT NOT NULL, github_updated_at TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(repository_id, pr_number)
);
CREATE TABLE evaluations (
  id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL REFERENCES repositories(id), pr_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL, baseline_sha TEXT NOT NULL, contract_hash TEXT NOT NULL REFERENCES contracts(hash),
  contract_snapshot TEXT NOT NULL CHECK(json_valid(contract_snapshot)),
  assignment_snapshot TEXT NOT NULL CHECK(json_valid(assignment_snapshot)),
  state TEXT NOT NULL CHECK(state IN ('CREATED','QUEUED','FETCHING','CHECKING','REVIEWING','SYNTHESIZING','COMPLETED','FAILED','SUPERSEDED')),
  evidence TEXT CHECK(evidence IS NULL OR json_valid(evidence)), report TEXT CHECK(report IS NULL OR json_valid(report)),
  context TEXT CHECK(context IS NULL OR json_valid(context)), failure_code TEXT, ai_status TEXT,
  check_run_id INTEGER, publication_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX evaluations_pr ON evaluations(repository_id,pr_number,created_at DESC);
CREATE INDEX evaluations_state ON evaluations(state,created_at);
CREATE TABLE outbox (
  run_id TEXT PRIMARY KEY REFERENCES evaluations(id), dispatched_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES evaluations(id),
  state TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id,state,detail)
);
CREATE TABLE artifacts (
  key TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES evaluations(id), sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_contract BEFORE UPDATE ON contracts BEGIN SELECT RAISE(ABORT,'Contracts are immutable'); END;
CREATE TRIGGER immutable_evaluation_inputs BEFORE UPDATE OF repository_id,pr_number,head_sha,baseline_sha,contract_hash,contract_snapshot,assignment_snapshot ON evaluations BEGIN SELECT RAISE(ABORT,'Evaluation inputs are immutable'); END;
