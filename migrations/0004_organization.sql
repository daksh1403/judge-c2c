-- Only the isolated ORG_DB stores real organization credentials and evaluation data.
CREATE TABLE IF NOT EXISTS organizer_sessions(hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS organizer_login_limits(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS github_setup_states(hash TEXT PRIMARY KEY,session_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS github_connection(id INTEGER PRIMARY KEY CHECK(id=1),app_id INTEGER NOT NULL,slug TEXT NOT NULL,encrypted TEXT NOT NULL,installation_id INTEGER);
CREATE TABLE IF NOT EXISTS github_repositories(id INTEGER PRIMARY KEY,full_name TEXT NOT NULL UNIQUE,private INTEGER NOT NULL,default_branch TEXT NOT NULL,accessible INTEGER NOT NULL DEFAULT 1);
