import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {getDatabase,migrateDatabase,closeDatabases} from '../server/database.js';
import {handleApi,initializeData} from '../server/handler.js';
test('admin CRUD, authorization, public visibility and durable restart',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pv-mvp-'));
 const env={SQLITE_PATH:path.join(dir,'db.sqlite'),ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:randomBytes(24).toString('hex')};
 let cookie='';
 async function call(route,method='GET',body,authenticated=true){const headers={'Origin':'http://localhost','Content-Type':'application/json'};if(authenticated&&cookie)headers.Cookie=cookie;const r=await handleApi(new Request('http://localhost/api/'+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env,{identityProvider:'local'});const data=await r.json();return {r,data};}
 try{
 let db=await getDatabase(env);await migrateDatabase(db);await initializeData(db);
 assert.equal((await call('personas')).data.personas.length,12);
 assert.ok([401,403].includes((await call('admin/personas')).r.status));
 const login=await call('auth/login','POST',{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD});assert.equal(login.r.status,200,JSON.stringify(login.data));cookie=login.r.headers.get('set-cookie').split(';')[0];
 const list=await call('admin/personas');assert.equal(list.r.status,200);const categoryId=list.data.categories[0].id;
 const created=await call('admin/personas','POST',{name:'手机测试人格',description:'可持久保存的测试人格',categoryId,systemPrompt:'你是一位清晰耐心的阅读伙伴，请先询问阅读目标。',status:'draft'});assert.ok([200,201].includes(created.r.status),JSON.stringify(created.data));const id=created.data.persona.id;
 assert.equal((await call('personas')).data.personas.some(p=>p.id===id),false);
 assert.equal((await call('admin/personas/'+id,'PATCH',{status:'published'})).r.status,200);
 let p=(await call('personas')).data.personas.find(p=>p.id===id);assert.ok(p);assert.equal(p.systemPrompt,undefined);assert.equal(p.prompt,undefined);
 await call('admin/personas/'+id,'PATCH',{name:'修改后的名称'});
 await closeDatabases();db=await getDatabase(env);await migrateDatabase(db);await initializeData(db);
 assert.equal((await call('personas')).data.personas.find(p=>p.id===id).name,'修改后的名称');
 await call('admin/personas/'+id,'PATCH',{status:'archived'});assert.equal((await call('personas')).data.personas.some(p=>p.id===id),false);
 assert.ok([200,204].includes((await call('admin/personas/'+id,'DELETE')).r.status));await initializeData(db);assert.equal((await call('admin/personas')).data.personas.some(p=>p.id===id),false);
 const cross=await handleApi(new Request('http://localhost/api/admin/personas',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json',Cookie:cookie},body:'{}'}),env);assert.equal(cross.status,403);
 const forged=await handleApi(new Request('http://localhost/api/admin/personas',{headers:{'oai-authenticated-user-email':env.ADMIN_EMAIL,'oai-authenticated-user-id':'forged'}}),env,{identityProvider:'local'});assert.ok([401,403].includes(forged.status));
 }finally{await closeDatabases();await rm(dir,{recursive:true,force:true});}
});
test('production never uses ephemeral storage and missing config is explicit',async()=>{
 const r=await handleApi(new Request('https://example.test/api/personas'),{NODE_ENV:'production'});assert.equal(r.status,503);
 const s=await handleApi(new Request('https://example.test/api/session'),{NODE_ENV:'production'});assert.equal((await s.json()).config.databaseReady,false);
});
test('database pagination, search, category, private records and direct detail',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pv-catalog-'));const env={SQLITE_PATH:path.join(dir,'db.sqlite'),ADMIN_EMAIL:'owner@example.test',ADMIN_PASSWORD:randomBytes(24).toString('hex')};
 try{
 const db=await getDatabase(env);await migrateDatabase(db);await initializeData(db);
 async function call(route,method='GET',body,cookie=''){const r=await handleApi(new Request('http://localhost/api/'+route,{method,headers:{Origin:'http://localhost','Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const auth=await call('auth/login','POST',{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD});const cookie=auth.cookie;
 const first=await call('personas?limit=5');assert.equal(first.data.personas.length,5);assert.equal(first.data.total,12);assert.equal(first.data.pages,3);
 const second=await call('personas?page=2&limit=5');assert.equal(second.data.personas.length,5);assert.equal(second.data.personas.some(p=>first.data.personas.some(x=>x.id===p.id)),false);
 assert.equal((await call('personas?q=moonlight')).data.total,1);
 assert.equal((await call('personas?q=%25')).data.total,0);
 assert.equal((await call('personas?limit=999')).status,400);
 const category=first.data.categories[0].id;const cats=await call('personas?category='+category);assert.ok(cats.data.personas.every(p=>p.categoryId===category));
 const made=await call('admin/personas','POST',{name:'索引新角色',description:'测试搜索更新',categoryId:category,systemPrompt:'你是原创学习伙伴。',status:'published'},cookie);const id=made.data.persona.id;
 assert.equal((await call('personas?q=索引新角色')).data.total,1);
 await call('admin/personas/'+id,'PATCH',{name:'更名角色',isPublic:false},cookie);
 assert.equal((await call('personas?q=索引新角色')).data.total,0);assert.equal((await call('personas/'+id)).status,404);
 await call('admin/personas/'+id,'PATCH',{isPublic:true},cookie);assert.equal((await call('personas/'+id)).data.persona.name,'更名角色');
 await closeDatabases();const reopened=await getDatabase(env);await migrateDatabase(reopened);await initializeData(reopened);assert.equal((await call('personas?q=更名角色')).data.total,1);
 }finally{await closeDatabases();await rm(dir,{recursive:true,force:true});}
});
test('SQLite migration preserves MVP data and upgrades the early catalog projection',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pv-upgrade-'));const env={SQLITE_PATH:path.join(dir,'db.sqlite')};
 try {
 const {readFile}=await import('node:fs/promises');const db=await getDatabase(env);
 const oldSchema=await readFile(new URL('../db/migrations/0001.sql',import.meta.url),'utf8');
 await db.batch(oldSchema.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 const data={id:'preserved',name:'保留的旧角色',description:'后台已有修改',categoryId:'category-0',systemPrompt:'私有提示词',tags:[],status:'published',isPublic:false};
 await db.prepare('INSERT INTO categories(id,name,sort_order) VALUES (?,?,?)').bind('category-0','情感陪伴',0).run();
 await db.prepare('INSERT INTO personas(id,data,status,sort_order) VALUES (?,?,?,?)').bind(data.id,JSON.stringify(data),'published',0).run();
 await db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').bind('catalog_seed_v1','already-initialized').run();
 await db.prepare('CREATE TABLE persona_catalog(id TEXT PRIMARY KEY,name TEXT NOT NULL,search_text TEXT NOT NULL,category_id TEXT NOT NULL,featured INTEGER NOT NULL DEFAULT 0)').run();
 await db.prepare('INSERT INTO persona_catalog(id,name,search_text,category_id,featured) VALUES (?,?,?,?,?)').bind('preserved','保留的旧角色','old','category-0',0).run();
 await migrateDatabase(db);await initializeData(db);await migrateDatabase(db);await initializeData(db);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM personas').first()).n,1);
 assert.equal(JSON.parse((await db.prepare('SELECT data FROM personas WHERE id=?').bind('preserved').first()).data).description,'后台已有修改');
 assert.equal((await db.prepare('SELECT is_public FROM persona_catalog WHERE id=?').bind('preserved').first()).is_public,0);
 assert.equal((await handleApi(new Request('http://localhost/api/personas'),env).then(r=>r.json())).total,0);
 } finally {await closeDatabases();await rm(dir,{recursive:true,force:true});}
});
test('admin write guards, invalid input, hashed sessions and login throttling',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pv-security-'));const env={SQLITE_PATH:path.join(dir,'db.sqlite'),ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:randomBytes(24).toString('hex')};
 try{
 const db=await getDatabase(env);await migrateDatabase(db);await initializeData(db);
 async function call(route,method='GET',body,cookie=''){const r=await handleApi(new Request('https://example.test/api/'+route,{method,headers:{Origin:'https://example.test','Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)}),env);return {r,data:await r.json()};}
 assert.equal((await call('admin/personas','POST',{role:'admin',name:'越权'})).r.status,401);
 const auth=await call('auth/login','POST',{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD});const set=auth.r.headers.get('set-cookie');assert.ok(set.includes('HttpOnly')&&set.includes('SameSite=Strict')&&set.includes('Secure'));const cookie=set.split(';')[0],raw=cookie.split('=')[1];
 const session=await db.prepare('SELECT token_hash FROM sessions').first();assert.notEqual(session.token_hash,raw);assert.equal(session.token_hash.length,64);
 assert.equal((await call('admin/personas','POST',{name:'x',avatarUrl:'javascript:alert(1)'},cookie)).r.status,400);
 assert.equal((await call('admin/personas','POST',{name:'x',tags:'not-an-array'},cookie)).r.status,400);
 assert.equal((await call('personas?sort=DROP%20TABLE')).r.status,400);
 assert.equal((await call('personas?q=%27%20OR%201%3D1%20--')).data.total,0);
 assert.equal((await call('admin/personas','POST',{name:'x',systemPrompt:'x'.repeat(20001)},cookie)).r.status,400);
 await call('auth/logout','POST',{},cookie);assert.equal((await call('admin/personas','GET',undefined,cookie)).r.status,401);
 for(let i=0;i<10;i++)assert.equal((await call('auth/login','POST',{email:env.ADMIN_EMAIL,password:'invalid-test-password'})).r.status,401);
 assert.equal((await call('auth/login','POST',{email:env.ADMIN_EMAIL,password:'invalid-test-password'})).r.status,429);
 }finally{await closeDatabases();await rm(dir,{recursive:true,force:true});}
});
