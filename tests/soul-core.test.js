import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {getDatabase,migrateDatabase,assertDatabaseReady,closeDatabases} from '../server/database.js';
import {initializeData,handleApi} from '../server/handler.js';
async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'pv-core-'));const env={SQLITE_PATH:join(dir,'test.sqlite'),ADMIN_EMAIL:'owner@example.test',ADMIN_PASSWORD:randomBytes(24).toString('hex'),AI_ENABLED:'false'};
 try{const db=await getDatabase(env);await run({db,env});}finally{await closeDatabases();await rm(dir,{recursive:true,force:true});}
}
async function client(db,env){
 await migrateDatabase(db);await initializeData(db);let cookie='';
 const call=async(path='',body,authenticated=true,origin='https://example.test')=>{
  const r=await handleApi(new Request('https://example.test/api/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:authenticated?cookie:''},body:body===undefined?undefined:JSON.stringify(body)}),env);
  return {status:r.status,data:await r.json(),headers:r.headers};
 };
 const auth=await call('auth/login',{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD});cookie=auth.headers.get('set-cookie').split(';')[0];return call;
}
test('migration journal is idempotent, rejects changed checksums, and readiness is read-only',()=>fixture(async({db})=>{
 await assert.rejects(()=>assertDatabaseReady(db),e=>e.code==='MIGRATION_REQUIRED');
 assert.equal((await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").first()).n,0);
 await migrateDatabase(db);await initializeData(db);await assertDatabaseReady(db);
 const journal=await db.prepare('SELECT * FROM schema_migrations ORDER BY id').all();assert.equal(journal.results.length,4);
 await migrateDatabase(db);assert.deepEqual((await db.prepare('SELECT * FROM schema_migrations ORDER BY id').all()).results,journal.results);
 await db.prepare("UPDATE schema_migrations SET checksum='invalid' WHERE id='0004_soul_core.sql'").run();
 await assert.rejects(()=>migrateDatabase(db),e=>e.code==='MIGRATION_MISMATCH');await assert.rejects(()=>assertDatabaseReady(db),e=>e.code==='MIGRATION_MISMATCH');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM personas').first()).n,12);
}));
test('legacy personas and prompt bytes survive migration; singleton link covers all old IDs',()=>fixture(async({db})=>{
 const sql=await readFile(new URL('../db/migrations/0001.sql',import.meta.url),'utf8');
 await db.batch(sql.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 const data=JSON.stringify({name:'旧人格',systemPrompt:'原提示词\n保持原样',background:'旧背景',personality:'独立性格',isPublic:false,tags:[]});
 await db.prepare('INSERT INTO personas(id,data,status,sort_order) VALUES (?,?,?,?)').bind('old-id',data,'archived',7).run();
 await db.prepare("INSERT INTO settings(key,value) VALUES ('catalog_seed_v1','legacy')").run();
 await migrateDatabase(db);await initializeData(db);await migrateDatabase(db);
 assert.deepEqual(await db.prepare("SELECT * FROM personas WHERE id='old-id'").first(),{id:'old-id',data,status:'archived',sort_order:7});
 assert.equal((await db.prepare("SELECT core_id FROM persona_core_links WHERE persona_id='old-id'").first()).core_id,'shared');
 await assert.rejects(()=>db.prepare("INSERT INTO soul_core(id,updated_at) VALUES ('another','now')").run());
 await assert.rejects(()=>db.prepare("INSERT INTO persona_core_links(persona_id,core_id) VALUES ('fake','shared')").run());
}));
test('empty draft, manual versions, publish, optimistic conflicts and rollback',()=>fixture(async({db,env})=>{
 const call=await client(db,env),path='admin/soul-core';let state=(await call(path)).data;
 assert.equal(state.core.draft_content,'');assert.equal(state.core.active_version_id,null);assert.deepEqual(state.versions,[]);
 assert.equal((await call(path+'/publish',{revision:0})).status,400);
 assert.equal((await call(path+'/draft',{revision:0,content:'管理员自行填写的测试核心一'})).status,200);
 assert.equal((await call(path+'/draft',{revision:0,content:'过时编辑'})).status,409);
 const first=await call(path+'/publish',{revision:1});assert.equal(first.status,200);const v1=first.data.activeVersionId;
 assert.equal((await call(path+'/draft',{revision:2,content:'管理员自行填写的测试核心二'})).status,200);
 const second=await call(path+'/publish',{revision:3});assert.equal(second.status,200);assert.notEqual(second.data.activeVersionId,v1);
 assert.equal((await call(path+'/rollback',{revision:4,versionId:v1})).status,200);
 state=(await call(path)).data;assert.equal(state.core.active_version_id,v1);assert.equal(state.core.draft_content,'管理员自行填写的测试核心二');assert.equal(state.versions.length,2);
 assert.equal(state.versions.find(v=>v.id===v1).content,'管理员自行填写的测试核心一');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM soul_core_events').first()).n,5);
 assert.equal((await call(path+'/draft',{revision:5,content:'x'.repeat(20001)})).status,400);
 assert.equal((await call(path+'/rollback',{revision:5,versionId:'nonexistent-id'})).status,404);
 assert.equal((await call(path+'?before=invalid')).status,400);
 // A malformed deferred pointer rolls back the whole transaction, not just its last statement.
 await assert.rejects(()=>db.batch([db.prepare("UPDATE soul_core SET active_version_id='missing-version' WHERE id='shared'"),db.prepare("UPDATE soul_core SET draft_content='must rollback' WHERE id='shared'")]));
 assert.equal((await call(path)).data.core.draft_content,'管理员自行填写的测试核心二');
}));
test('ordinary users cannot access core; public catalog is isolated and persona thirteen auto-links',()=>fixture(async({db,env})=>{
 const call=await client(db,env),path='admin/soul-core';
 for(const route of [path,path+'/draft',path+'/publish',path+'/rollback'])assert.equal((await call(route,route===path?undefined:{revision:0,content:'unauthorized'},false)).status,401);
 assert.equal((await call(path+'/draft',{revision:0,content:'cross-site'},true,'https://evil.example')).status,403);
 assert.equal((await call(path+'/draft',{revision:0,content:'管理员测试私有核心文本'})).status,200);
 const before=(await db.prepare('SELECT id,data FROM personas ORDER BY id').all()).results;
 const made=await call('admin/personas',{name:'第十三个人格',description:'新增角色',background:'独立背景',personality:'独立个性',systemPrompt:'独立提示词',categoryId:'category-0',status:'published'});
 assert.equal(made.status,201);assert.equal((await db.prepare('SELECT count(*) AS n FROM persona_core_links').first()).n,13);
 assert.equal((await db.prepare('SELECT core_id FROM persona_core_links WHERE persona_id=?').bind(made.data.persona.id).first()).core_id,'shared');
 assert.equal(made.data.persona.systemPrompt,'独立提示词');
 for(const row of before)assert.equal((await db.prepare('SELECT data FROM personas WHERE id=?').bind(row.id).first()).data,row.data);
 assert.equal((await call('admin/personas',{name:'非法绑定',coreId:'other'})).status,400);
 const publicData=(await call('personas')).data;assert.equal(JSON.stringify(publicData).includes('管理员测试私有核心文本'),false);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM ai_requests').first()).n,0);
}));
test('concurrent drafts have one winner and do not produce phantom versions or events',()=>fixture(async({db,env})=>{
 const call=await client(db,env),path='admin/soul-core';
 const results=await Promise.all([call(path+'/draft',{revision:0,content:'编辑A'}),call(path+'/draft',{revision:0,content:'编辑B'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM soul_core_events').first()).n,1);
 const published=await Promise.all([call(path+'/publish',{revision:1}),call(path+'/publish',{revision:1})]);
 assert.deepEqual(published.map(r=>r.status).sort(),[200,409]);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM soul_core_versions').first()).n,1);
}));


test('failed migration transaction leaves no applied record and can be retried safely',()=>fixture(async({db})=>{
 await db.prepare('CREATE TABLE personas(id TEXT PRIMARY KEY)').run();
 await assert.rejects(()=>migrateDatabase(db));
 assert.equal((await db.prepare('SELECT count(*) AS n FROM schema_migrations').first()).n,0);
 assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='categories'").first(),null);
 // Repair only this deliberately broken empty fixture, never a real database.
 await db.prepare('DROP TABLE personas').run();
 await migrateDatabase(db);await initializeData(db);await assertDatabaseReady(db);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM schema_migrations').first()).n,4);
}));
test('explicit initialization repairs missing links without changing an existing profile',()=>fixture(async({db})=>{
 await migrateDatabase(db);await initializeData(db);
 const data=JSON.stringify({name:'旧应用新增',tags:[],systemPrompt:'保留原样'});
 await db.prepare('INSERT INTO personas(id,data,status,sort_order) VALUES (?,?,?,?)').bind('after-rollback',data,'draft',0).run();
 await assert.rejects(()=>assertDatabaseReady(db),e=>e.code==='MIGRATION_REQUIRED');
 await migrateDatabase(db);await initializeData(db);await assertDatabaseReady(db);
 assert.equal((await db.prepare("SELECT core_id FROM persona_core_links WHERE persona_id='after-rollback'").first()).core_id,'shared');
 assert.equal((await db.prepare("SELECT data FROM personas WHERE id='after-rollback'").first()).data,data);
}));

test('version pagination preserves all snapshots; clearing draft never clears active version',()=>fixture(async({db,env})=>{
 const call=await client(db,env),path='admin/soul-core';let revision=0;
 for(let i=0;i<21;i++){
  const saved=await call(path+'/draft',{revision,content:'fixture-content-'+i});assert.equal(saved.status,200);revision=saved.data.revision;
  const published=await call(path+'/publish',{revision});assert.equal(published.status,200);revision=published.data.revision;
 }
 const first=(await call(path)).data;assert.equal(first.versions.length,20);assert.ok(first.nextBefore);
 const second=(await call(path+'?before='+first.nextBefore)).data;assert.equal(second.versions.length,1);assert.equal(second.nextBefore,null);
 assert.equal(second.versions[0].content,'fixture-content-0');
 assert.equal((await call(path+'/versions/'+second.versions[0].id,{revision,content:'override'})).status,404);
 assert.equal((await call(path+'/draft',{revision,content:''})).status,200);
 assert.equal((await call(path+'/publish',{revision:revision+1})).status,400);
 const current=(await call(path)).data;assert.equal(current.core.active_version_id,first.core.active_version_id);assert.equal(current.core.draft_content,'');
 assert.equal((await call('soul-core',undefined,false)).status,404);
}));
