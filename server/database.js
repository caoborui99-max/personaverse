import { chatSchema } from './ai-chat.js';
import { ApiError } from './security.js';
const connections = new Map();
export const schemaSql = `
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS personas (id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, credential_hash TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS persona_catalog (id TEXT PRIMARY KEY, name TEXT NOT NULL, search_text TEXT NOT NULL, category_id TEXT NOT NULL, featured INTEGER NOT NULL DEFAULT 0,is_public INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS persona_catalog_category ON persona_catalog(category_id,id);
CREATE INDEX IF NOT EXISTS persona_catalog_name ON persona_catalog(name,id);
CREATE INDEX IF NOT EXISTS personas_status_order ON personas(status,sort_order);
`;
function portableSql(sql) {
  let n = 0;
  return sql.replace(/'[^']*(?:''[^']*)*'|\?/g, match => match === '?' ? '$' + (++n) : match);
}
function prepared(owner, sql, params = []) {
  return { sql, params, bind(...values) { return prepared(owner, sql, values); }, async first(column) { const r = await owner.execute(sql, params); const row = r.results[0] || null; return column && row ? row[column] : row; }, async all() { return owner.execute(sql, params); }, async run() { return owner.execute(sql, params); } };
}
export async function getDatabase(env = {}) {
  if (env.DB) return env.DB;
  const production=env.NODE_ENV==='production'||!!env.VERCEL;
  if(env.DATABASE_DRIVER==='sqlite'&&env.DATABASE_URL)throw new ApiError(503,'DATABASE_CONFIG_CONFLICT','SQLite 配置不能同时设置 DATABASE_URL。');
  if(env.VERCEL&&env.DATABASE_DRIVER==='sqlite')throw new ApiError(503,'DATABASE_NOT_CONFIGURED','Serverless 环境不能使用单机生产 SQLite。');
  if (env.DATABASE_URL) {
    const key = 'neon:' + env.DATABASE_URL;
    if (connections.has(key)) return connections.get(key);
    const { neon } = await import('@neondatabase/serverless');
    const client = neon(env.DATABASE_URL);
    const normalize = r => ({ results: r.rows || [], meta: { changes: r.rowCount || 0 } });
    const db = {
      dialect: 'postgres',
      async execute(sql, params = []) { return normalize(await client.query(portableSql(sql), params, { fullResults: true })); },
      prepare(sql) { return prepared(db, sql); },
      async batch(statements) { const results = await client.transaction(statements.map(s => client.query(portableSql(s.sql), s.params)), { fullResults: true }); return results.map(normalize); },
      close() {}
    };
    connections.set(key, db); return db;
  }
  if (production && env.DATABASE_DRIVER!=='sqlite') throw new ApiError(503, 'DATABASE_NOT_CONFIGURED', '尚未配置生产数据库 DATABASE_URL。');
  const { resolve, dirname, isAbsolute } = await import('node:path'); const { mkdir,realpath,lstat,chmod } = await import('node:fs/promises');
  if(production&&(!env.SQLITE_PATH||!isAbsolute(env.SQLITE_PATH)))throw new ApiError(503,'SQLITE_PATH_REQUIRED','生产 SQLite 需要明确的绝对持久化路径。');
  const file = resolve(env.SQLITE_PATH || '.local/personaverse.sqlite');
  const temporary=p=>['/tmp','/var/tmp','/dev/shm','/run'].some(base=>p===base||p.startsWith(base+'/'));
  if(production&&temporary(file))throw new ApiError(503,'SQLITE_PATH_UNSAFE','生产数据库不能位于临时目录。');
  if (connections.has(file)) return connections.get(file);
  await mkdir(dirname(file), { recursive: true, mode:0o700 });
  if(production&&temporary(await realpath(dirname(file))))throw new ApiError(503,'SQLITE_PATH_UNSAFE','生产数据库不能通过符号链接指向临时目录。');
  const info=await lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(info&&(!info.isFile()||info.isSymbolicLink()))throw new ApiError(503,'SQLITE_PATH_UNSAFE','数据库必须是常规文件。');
  const { DatabaseSync } = await import('node:sqlite'); const local = new DatabaseSync(file);
  await chmod(file,0o600);
  local.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  function execute(sql, params = []) {
    const stmt = local.prepare(sql);
    if (stmt.columns().length) return { results: stmt.all(...params).map(row => ({ ...row })), meta: { changes: 0 } };
    const result = stmt.run(...params); return { results: [], meta: { changes: Number(result.changes) } };
  }
  const db = {
    dialect: 'sqlite',
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
  const statements = (schemaSql+chatSchema).split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql));
  await db.batch(statements);
  // Compatibility with the uncommitted first catalog prototype: preserve all rows.
  const columns = db.dialect === 'postgres'
    ? (await db.prepare("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='persona_catalog'").all()).results
    : (await db.prepare('PRAGMA table_info(persona_catalog)').all()).results;
  if (!columns.some(column => column.name === 'is_public')) {
    await db.batch([db.prepare('ALTER TABLE persona_catalog ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1'),db.prepare("INSERT INTO settings(key,value) VALUES ('catalog_visibility_reindex','pending') ON CONFLICT(key) DO UPDATE SET value=excluded.value")]);
  }
}
export async function closeDatabases() { for (const db of connections.values()) await db.close(); connections.clear(); }
