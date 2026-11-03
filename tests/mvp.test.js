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
