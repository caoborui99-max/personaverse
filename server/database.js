import { ApiError } from './security.js';
const connections = new Map();
function portableSql(sql) {
  let n = 0;
  return sql.replace(/'[^']*(?:''[^']*)*'|\?/g, match => match === '?' ? '$' + (++n) : match);
}
function prepared(owner, sql, params = []) {
  return { sql, params, bind(...values) { return prepared(owner, sql, values); }, async first(column) { const r = await owner.execute(sql, params); const row = r.results[0] || null; return column && row ? row[column] : row; }, async all() { return owner.execute(sql, params); }, async run() { return owner.execute(sql, params); } };
}
export async function getDatabase(env = {}, options = {}) {
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
  if(options.mustExist && !await lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;}))throw new ApiError(503,'MIGRATION_REQUIRED','数据库不存在，请先运行独立迁移命令。');
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
export { migrateDatabase, assertDatabaseReady } from './migrations.js';
export async function closeDatabases() { for (const db of connections.values()) await db.close(); connections.clear(); }
