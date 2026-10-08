CREATE TABLE organization_retirement (
 id INTEGER PRIMARY KEY CHECK(id=1),
 state TEXT NOT NULL CHECK(state IN ('ACTIVE','RETIRING','RETIRED')) DEFAULT 'ACTIVE',
 replacement TEXT CHECK(replacement IS NULL OR json_valid(replacement)),
 authorized_by TEXT, authorized_at TEXT, retired_at TEXT,
 app_id INTEGER, installation_id INTEGER, error TEXT,
 lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO organization_retirement(id) VALUES(1);
CREATE TRIGGER retirement_no_new_evaluations BEFORE INSERT ON evaluations
WHEN EXISTS(SELECT 1 FROM organization_retirement WHERE state<>'ACTIVE')
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_RETIRED'); END;
