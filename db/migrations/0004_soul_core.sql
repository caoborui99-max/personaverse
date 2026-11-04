CREATE TABLE IF NOT EXISTS soul_core_versions (id TEXT PRIMARY KEY,core_id TEXT NOT NULL CHECK(core_id='shared'),revision INTEGER NOT NULL UNIQUE,content TEXT NOT NULL CHECK(length(trim(content))>0),created_by TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS soul_core (id TEXT PRIMARY KEY CHECK(id='shared'),draft_content TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,active_version_id TEXT REFERENCES soul_core_versions(id) DEFERRABLE INITIALLY DEFERRED,last_operation TEXT,updated_at TEXT NOT NULL);
INSERT INTO soul_core(id,draft_content,revision,updated_at) VALUES ('shared','',0,'initial') ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS persona_core_links (persona_id TEXT PRIMARY KEY REFERENCES personas(id),core_id TEXT NOT NULL DEFAULT 'shared' CHECK(core_id='shared') REFERENCES soul_core(id));
INSERT INTO persona_core_links(persona_id,core_id) SELECT id,'shared' FROM personas WHERE 1=1 ON CONFLICT(persona_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS soul_core_events (id TEXT PRIMARY KEY,action TEXT NOT NULL,actor TEXT NOT NULL,revision INTEGER NOT NULL,version_id TEXT,created_at TEXT NOT NULL);
