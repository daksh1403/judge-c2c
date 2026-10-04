-- One bounded reviewer slot per provider in this development deployment.
CREATE TABLE reviewer_slots(provider TEXT PRIMARY KEY,owner TEXT NOT NULL,lease_until INTEGER NOT NULL);
