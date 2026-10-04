ALTER TABLE organizer_sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'organizer' CHECK(role IN('organizer','judge'));
