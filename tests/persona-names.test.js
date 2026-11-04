import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {seedPersonas} from '../server/seed-data.js';
import {personaNames,planPersonaNames,applyPersonaNames,profileHash} from '../server/persona-names.js';
import {getDatabase,migrateDatabase,closeDatabases} from '../server/database.js';
import {initializeData,handleApi} from '../server/handler.js';
async function legacy(){const context={window:{}};runInNewContext(await readFile(new URL('../preview-dist/js/personas.js',import.meta.url),'utf8'),context);return JSON.parse(JSON.stringify(context.window.PERSONAS));}
function profile(p,index){const data={...p,categoryId:'category-'+['情感陪伴','效率工具','学习成长','创意灵感','趣味角色'].indexOf(p.category),avatarUrl:'',systemPrompt:p.prompt,copyEnabled:true,status:'published',sortOrder:index,welcomeMessage:'',exampleQuestions:[]};delete data.prompt;return data;}
async function fixture(run){const dir=await mkdtemp(join(tmpdir(),'pv-names-'));const env={SQLITE_PATH:join(dir,'test.sqlite'),ADMIN_EMAIL:'owner@example.test',ADMIN_PASSWORD:randomBytes(24).toString('hex'),AI_ENABLED:'false'};try{const db=await getDatabase(env);await migrateDatabase(db);await initializeData(db);await run({db,env});}finally{await closeDatabases();await rm(dir,{recursive:true,force:true});}}
async function restoreLegacy(db){for(const [i,p] of (await legacy()).entries())await db.prepare('UPDATE personas SET data=? WHERE id=?').bind(JSON.stringify(profile(p,i)),p.id).run();await initializeData(db);}
async function protectedState(db){const tables=['soul_core','soul_core_versions','soul_core_events','persona_core_links','schema_migrations','ai_threads','ai_requests'];return Promise.all(tables.map(async t=>({table:t,rows:(await db.prepare('SELECT * FROM '+t+' ORDER BY 1').all()).results})));}
test('twelve IDs and requested display names match; only names and explicit self references change',async()=>{
 const expected={'moonlight':'晚柠','muse':'MIRA','mentor':'零序','code-pilot':'KAI-07','focus-planner':'阿序','english-friend':'洛伊','career-compass':'北辰','story-weaver':'弦月','quiet-garden':'小满','cosmic-traveler':'NOVA','record-store':'黑胶先生','clear-writer':'砚白'};
 const old=await legacy();assert.equal(seedPersonas.length,12);assert.deepEqual(seedPersonas.map(p=>p.id),old.map(p=>p.id));
 for(const [i,p] of seedPersonas.entries()){
  assert.equal(p.name,expected[p.id]);const entry=personaNames.find(x=>x.id===p.id);
  const target={...old[i],name:expected[p.id],prompt:entry.rules.reduce((s,[a,b])=>s.replaceAll(a,b),old[i].prompt)};
  assert.deepEqual(p,target);assert.equal(profileHash(profile(old[i],i)),entry.oldHash);assert.equal(profileHash(profile(p,i)),entry.newHash);
 }
 assert.ok(seedPersonas[0].description.includes('慢慢说完'));assert.ok(seedPersonas.find(p=>p.id==='record-store').prompt.includes('「午夜唱片店」的虚构店主'));
});
test('fresh database has formal names; repeat seed does not overwrite administrator edits',()=>fixture(async({db})=>{
 const rows=(await db.prepare('SELECT id,data FROM personas ORDER BY id').all()).results;assert.equal(rows.length,12);
 for(const row of rows)assert.equal(JSON.parse(row.data).name,personaNames.find(x=>x.id===row.id).newName);
 const data={...JSON.parse(rows[0].data),name:'管理员名称',systemPrompt:'管理员提示词',background:'管理员背景'};
 await db.prepare('UPDATE personas SET data=? WHERE id=?').bind(JSON.stringify(data),rows[0].id).run();await initializeData(db);
 assert.deepEqual(JSON.parse((await db.prepare('SELECT data FROM personas WHERE id=?').bind(rows[0].id).first()).data),data);
}));
test('legacy plan is read-only; reviewed apply updates catalog atomically and is idempotent',()=>fixture(async({db,env})=>{
 await restoreLegacy(db);
 await db.prepare("INSERT INTO soul_core_versions(id,core_id,revision,content,created_by,created_at) VALUES ('version-fixture','shared',1,'private fixture','fixture','fixture')").run();
 await db.prepare("UPDATE soul_core SET active_version_id='version-fixture',revision=1 WHERE id='shared'").run();
 await db.prepare("INSERT INTO ai_threads(id,owner,persona_id,history) VALUES ('thread-fixture','fixture','moonlight',?)").bind(JSON.stringify([{role:'assistant',content:'我是月白，历史文本必须保留。'}])).run();
 const before=await protectedState(db);const original=(await db.prepare('SELECT * FROM personas ORDER BY id').all()).results;
 const plan=await planPersonaNames(db);assert.equal(plan.items.length,12);assert.deepEqual((await db.prepare('SELECT * FROM personas ORDER BY id').all()).results,original);assert.equal(JSON.stringify(plan).includes('systemPrompt:'),false);
 assert.equal((await applyPersonaNames(db,plan)).applied.length,12);assert.deepEqual(await protectedState(db),before);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'persona_names_v1:%'").first()).n,1);
 assert.equal((await applyPersonaNames(db,plan)).applied.length,0);assert.equal((await planPersonaNames(db)).items.length,0);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'persona_names_v1:%'").first()).n,1);
 const result=await handleApi(new Request('https://example.test/api/personas?q='+encodeURIComponent('晚柠')),env).then(r=>r.json());assert.equal(result.total,1);assert.equal(result.personas[0].id,'moonlight');
 for(const row of (await db.prepare('SELECT id,data FROM personas').all()).results)assert.equal(JSON.parse(row.data).name,personaNames.find(x=>x.id===row.id).newName);
}));
test('customized, private, archived, deleted and unrelated profiles are never auto-renamed',()=>fixture(async({db})=>{
 await restoreLegacy(db);
 const edits=[['moonlight',{name:'我自己的角色'}],['muse',{systemPrompt:'定制提示词'}],['mentor',{background:'定制背景'}],['code-pilot',{isPublic:false}],['focus-planner',{updatedAt:'custom-edit'}]];
 for(const [id,patch] of edits){const row=await db.prepare('SELECT data FROM personas WHERE id=?').bind(id).first();await db.prepare('UPDATE personas SET data=? WHERE id=?').bind(JSON.stringify({...JSON.parse(row.data),...patch}),id).run();}
 await db.prepare("UPDATE personas SET status='archived' WHERE id='english-friend'").run();await db.prepare("UPDATE personas SET status='deleted' WHERE id='career-compass'").run();
 const before=(await db.prepare('SELECT * FROM personas ORDER BY id').all()).results;await initializeData(db);assert.deepEqual((await db.prepare('SELECT * FROM personas ORDER BY id').all()).results,before);
 const plan=await planPersonaNames(db);assert.equal(plan.items.length,5);await applyPersonaNames(db,plan);
 for(const row of before.filter(p=>!plan.items.some(x=>x.id===p.id)))assert.deepEqual(await db.prepare('SELECT * FROM personas WHERE id=?').bind(row.id).first(),row);
}));
test('tampered and stale plans reject without partial changes',()=>fixture(async({db})=>{
 await restoreLegacy(db);const plan=await planPersonaNames(db);
 const tampered=structuredClone(plan);tampered.items[0].toName='unauthorized';await assert.rejects(()=>applyPersonaNames(db,tampered),e=>e.code==='INVALID_NAME_PLAN');
 const data=JSON.parse((await db.prepare("SELECT data FROM personas WHERE id='muse'").first()).data);data.description+='管理员修改';await db.prepare("UPDATE personas SET data=? WHERE id='muse'").bind(JSON.stringify(data)).run();
 const before=(await db.prepare('SELECT * FROM personas ORDER BY id').all()).results;await assert.rejects(()=>applyPersonaNames(db,plan),e=>e.code==='NAME_PLAN_STALE');assert.deepEqual((await db.prepare('SELECT * FROM personas ORDER BY id').all()).results,before);
}));
test('concurrent edits cause transactional rollback, preserving all profiles and audit state',()=>fixture(async({db})=>{
 await restoreLegacy(db);const plan=await planPersonaNames(db);const before=(await db.prepare('SELECT * FROM personas ORDER BY id').all()).results;
 const proxy={...db,batch:async statements=>{
  const row=await db.prepare("SELECT data FROM personas WHERE id='muse'").first();const data=JSON.parse(row.data);data.name='并发管理员修改';await db.prepare("UPDATE personas SET data=? WHERE id='muse'").bind(JSON.stringify(data)).run();
  return db.batch(statements);
 }};
 await assert.rejects(()=>applyPersonaNames(proxy,plan));
 assert.deepEqual(await db.prepare("SELECT * FROM personas WHERE id='moonlight'").first(),before.find(r=>r.id==='moonlight'));
 assert.equal(JSON.parse((await db.prepare("SELECT data FROM personas WHERE id='muse'").first()).data).name,'并发管理员修改');
 assert.equal((await db.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'persona_names_v1:%'").first()).n,0);
}));
test('persona thirteen remains dynamic with the same core and independent chosen name',()=>fixture(async({db,env})=>{
 const login=await handleApi(new Request('https://example.test/api/auth/login',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD})}),env);const cookie=login.headers.get('set-cookie').split(';')[0];
 const result=await handleApi(new Request('https://example.test/api/admin/personas',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({name:'第十三个原创角色',description:'独立角色',categoryId:'category-0',systemPrompt:'独立提示词',status:'published'})}),env);assert.equal(result.status,201);const p=(await result.json()).persona;
 assert.equal((await db.prepare('SELECT core_id FROM persona_core_links WHERE persona_id=?').bind(p.id).first()).core_id,'shared');assert.equal((await planPersonaNames(db)).items.length,0);await initializeData(db);assert.equal(JSON.parse((await db.prepare('SELECT data FROM personas WHERE id=?').bind(p.id).first()).data).name,'第十三个原创角色');
}));
