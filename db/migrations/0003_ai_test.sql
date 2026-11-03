-- AI administrator test tables; use npm run db:migrate.

CREATE TABLE IF NOT EXISTS ai_threads(id TEXT PRIMARY KEY,owner TEXT NOT NULL,persona_id TEXT NOT NULL,history TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_requests(id TEXT PRIMARY KEY,owner TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL,response TEXT);
CREATE TABLE IF NOT EXISTS ai_budget(day TEXT PRIMARY KEY,calls INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_rates(owner TEXT PRIMARY KEY,bucket TEXT NOT NULL,calls INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_locks(owner TEXT PRIMARY KEY,request_id TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ai_threads_owner ON ai_threads(owner,persona_id);
