CREATE TABLE preview_sessions (
  owner_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE preview_runs (
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL REFERENCES preview_sessions(owner_hash),
  request_hash TEXT NOT NULL,
  request TEXT NOT NULL CHECK(json_valid(request)),
  snapshot_hash TEXT,
  snapshot TEXT CHECK(snapshot IS NULL OR json_valid(snapshot)),
  state TEXT NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','FETCHING','CHECKING','SYNTHESIZING','COMPLETED','FAILED')),
  context TEXT CHECK(context IS NULL OR json_valid(context)),
  evidence TEXT CHECK(evidence IS NULL OR json_valid(evidence)),
  report TEXT CHECK(report IS NULL OR json_valid(report)),
  failure_code TEXT,
  dispatched_at TEXT,
  timeline TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(timeline)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX preview_owner ON preview_runs(owner_hash,created_at DESC);
CREATE TABLE preview_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL);
CREATE TRIGGER preview_inputs_immutable BEFORE UPDATE OF request,owner_hash,request_hash ON preview_runs BEGIN SELECT RAISE(ABORT,'Preview inputs are immutable'); END;
CREATE TRIGGER preview_snapshot_immutable BEFORE UPDATE OF snapshot,snapshot_hash ON preview_runs WHEN OLD.snapshot IS NOT NULL BEGIN SELECT RAISE(ABORT,'Preview snapshot is immutable'); END;
CREATE TRIGGER preview_results_immutable BEFORE UPDATE OF context,evidence,report ON preview_runs WHEN OLD.state IN ('COMPLETED','FAILED') BEGIN SELECT RAISE(ABORT,'Preview results are immutable'); END;
