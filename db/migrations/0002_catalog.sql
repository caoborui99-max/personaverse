CREATE TABLE IF NOT EXISTS persona_catalog (id TEXT PRIMARY KEY, name TEXT NOT NULL, search_text TEXT NOT NULL, category_id TEXT NOT NULL, featured INTEGER NOT NULL DEFAULT 0, is_public INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS persona_catalog_category ON persona_catalog(category_id,id);
CREATE INDEX IF NOT EXISTS persona_catalog_name ON persona_catalog(name,id);
