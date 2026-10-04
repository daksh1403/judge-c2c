-- Only trusted operators may prepare this cache. No HTTP endpoint writes it.
CREATE TABLE public_github_snapshots (
  id TEXT PRIMARY KEY,
  repository TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  sha256 TEXT NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE INDEX public_snapshot_lookup ON public_github_snapshots(repository,pr_number,captured_at DESC);
CREATE TRIGGER public_snapshot_immutable BEFORE UPDATE ON public_github_snapshots BEGIN SELECT RAISE(ABORT,'Public GitHub snapshots are immutable'); END;
