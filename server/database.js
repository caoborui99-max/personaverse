import { ApiError } from './security.js';
const connections = new Map();
export const schemaSql = `
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS personas (id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, credential_hash TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS personas_status_order ON personas(status,sort_order);
`;
function portableSql(sql) {
  let n = 0; let quoted = false;
  return sql.replace(/'[^']*(?:''[^']*)*'|\?/g, match => match === '?' ? '$' + (++n) : match);
}
function prepared(owner, sql, params = []) {
  return { sql, params, bind(...values) { return prepared(owner, sql, values); }, async first(column) { const r = await owner.execute(sql, params); const row = r.results[0] || null; return column && row ? row[column] : row; }, async all() { return owner.execute(sql, params); }, async run() { return owner.execute(sql, params); } };
}
export async function getDatabase(env = {}) {
  if (env.DB) return env.DB;
  if (env.DATABASE_URL) {
    const key = 'neon:' + env.DATABASE_URL;
    if (connections.has(key)) return connections.get(key);
    const { neon } = await import('@neondatabase/serverless');
    const client = neon(env.DATABASE_URL);
    const normalize = r => ({ results: r.rows || [], meta: { changes: r.rowCount || 0 } });
    const db = {
      async execute(sql, params = []) { return normalize(await client.query(portableSql(sql), params, { fullResults: true })); },
      prepare(sql) { return prepared(db, sql); },
      async batch(statements) { const results = await client.transaction(statements.map(s => client.query(portableSql(s.sql), s.params)), { fullResults: true }); return results.map(normalize); },
      close() {}
    };
    connections.set(key, db); return db;
  }
  if (env.VERCEL || env.NODE_ENV === 'production') throw new ApiError(503, 'DATABASE_NOT_CONFIGURED', '尚未配置生产数据库 DATABASE_URL。');
  const { resolve, dirname } = await import('node:path'); const { mkdir } = await import('node:fs/promises');
  const file = resolve(env.SQLITE_PATH || '.local/personaverse.sqlite');
  if (connections.has(file)) return connections.get(file);
  await mkdir(dirname(file), { recursive: true });
  const { DatabaseSync } = await import('node:sqlite'); const local = new DatabaseSync(file);
  local.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  function execute(sql, params = []) {
    const stmt = local.prepare(sql);
    if (stmt.columns().length) return { results: stmt.all(...params).map(row => ({ ...row })), meta: { changes: 0 } };
    const result = stmt.run(...params); return { results: [], meta: { changes: Number(result.changes) } };
  }
  const db = {
    async execute(sql, params) { return execute(sql, params); }, prepare(sql) { return prepared(db, sql); },
    async batch(statements) {
      local.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(s => execute(s.sql, s.params)); local.exec('COMMIT'); return results; }
      catch (error) { local.exec('ROLLBACK'); throw error; }
    }, close() { local.close(); }
  };
  connections.set(file, db); return db;
}
export async function migrateDatabase(db) {
  const statements = schemaSql.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql));
  await db.batch(statements);
}
export async function closeDatabases() { for (const db of connections.values()) await db.close(); connections.clear(); }
