ALTER TABLE assignments ADD COLUMN contract_hash TEXT REFERENCES contracts(hash);
UPDATE assignments SET contract_hash=(SELECT active_contract_hash FROM repositories WHERE id=assignments.repository_id);
