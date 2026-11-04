import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ApiError } from './security.js';
const files=['0001.sql','0002_catalog.sql','0003_ai_test.sql','0004_soul_core.sql'];
async function manifest() {
  return Promise.all(files.map(async id=>{
    const sql=await readFile(new URL('../db/migrations/'+id,import.meta.url),'utf8');
    // Include the legacy compatibility routine's version in its checksum.
    const checksum=createHash('sha256').update(sql+(id==='0002_catalog.sql'?'\nlegacy-visibility-v1':'')).digest('hex');
    return {id,sql,checksum};
  }));
}
async function recorded(db) {
  try { return (await db.prepare('SELECT id,checksum FROM schema_migrations ORDER BY id').all()).results; }
  catch { throw new ApiError(503,'MIGRATION_REQUIRED','数据库尚未就绪，请由操作者先执行独立迁移命令。'); }
}
function verify(rows, expected, complete=false) {
  for(const row of rows) {
    const entry=expected.find(e=>e.id===row.id);
    if(!entry || entry.checksum!==row.checksum) throw new ApiError(503,'MIGRATION_MISMATCH','迁移记录与代码不匹配；请停止并核对发布版本。');
  }
  if(complete&&rows.length!==expected.length)throw new ApiError(503,'MIGRATION_REQUIRED','存在待执行迁移，请先备份并运行独立迁移命令。');
}
export async function assertDatabaseReady(db) {
  verify(await recorded(db),await manifest(),true);
  const core=await db.prepare("SELECT id FROM soul_core WHERE id='shared'").first();
  const seed=await db.prepare("SELECT value FROM settings WHERE key='catalog_seed_v1'").first();
  const missing=await db.prepare('SELECT p.id FROM personas p LEFT JOIN persona_core_links l ON l.persona_id=p.id WHERE l.persona_id IS NULL LIMIT 1').first();
  if(!core||!seed||missing)throw new ApiError(503,'MIGRATION_REQUIRED','数据库初始化或核心关联未完成，请运行独立迁移命令。');
}
export async function migrateDatabase(db) {
  const entries=await manifest();
  // Only the explicit migration path creates the journal or changes schema.
  await db.prepare('CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)').run();
  const rows=await recorded(db);verify(rows,entries);
  for(const entry of entries) {
    if(rows.some(row=>row.id===entry.id))continue;
    const statements=entry.sql.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean).map(sql=>db.prepare(sql));
    if(entry.id==='0002_catalog.sql') {
      const columns=db.dialect==='postgres'
        ? (await db.prepare("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='persona_catalog'").all()).results
        : (await db.prepare('PRAGMA table_info(persona_catalog)').all()).results;
      if(columns.length&&!columns.some(c=>c.name==='is_public')) {
        statements.push(db.prepare('ALTER TABLE persona_catalog ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1'));
        statements.push(db.prepare("INSERT INTO settings(key,value) VALUES ('catalog_visibility_reindex','pending') ON CONFLICT(key) DO UPDATE SET value=excluded.value"));
      }
    }
    statements.push(db.prepare('INSERT INTO schema_migrations(id,checksum,applied_at) VALUES (?,?,?)').bind(entry.id,entry.checksum,new Date().toISOString()));
    // DDL/data and journal entry commit together. Concurrent operators fail/rollback, never silently skip.
    await db.batch(statements);
  }
}
