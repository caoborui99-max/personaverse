import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {getDatabase,migrateDatabase,closeDatabases} from '../server/database.js';
import {initializeData,handleApi} from '../server/handler.js';
import {createProvider} from '../server/ai-provider.js';
import {costConfiguration,estimateCost,reserveChatCost} from '../server/chat-cost.js';
import {costEnv} from './fixtures/cost.js';
import {sha256} from '../server/security.js';

async function fixture(run) {
 const dir=await mkdtemp(join(tmpdir(),'pv-dev-quota-'));
 const env=costEnv({SQLITE_PATH:join(dir,'fixture.sqlite'),ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:randomBytes(24).toString('hex'),
   AI_ENABLED:'true',AI_QUOTA_MODE:'development',AI_ADMIN_RATE_LIMIT:'3',AI_BASE_URL:'https://api.deepseek.com/v1',AI_MODEL:'fixture-model',AI_API_KEY:'synthetic-not-a-real-key'});
 let clock=Date.now(),cookie='';const calls=[];
 const provider={complete:async messages=>{calls.push(messages);return 'Offline quota fixture';}};
 const api=async(path,body,authenticated=true,options={})=>{
   const response=await handleApi(new Request('https://example.test/api/'+path,{method:body===undefined?'GET':'POST',
     headers:{Origin:'https://example.test','Content-Type':'application/json',Cookie:authenticated?cookie:''},body:body===undefined?undefined:JSON.stringify(body)}),env,{provider,now:()=>clock,...options});
   return {status:response.status,data:await response.json()};
 };
 const send=(body={},authenticated=true,options={})=>api('ai/chat',{personaId:'moonlight',message:'fixture',requestId:randomUUID(),...body},authenticated,options);
 try{
   const db=await getDatabase(env);await migrateDatabase(db);await initializeData(db);
   const login=await handleApi(new Request('https://example.test/api/auth/login',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD})}),env);
   assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
   await run({env,db,calls,api,send,provider,advance:ms=>{clock+=ms;},now:()=>new Date(clock)});
 }finally{await closeDatabases();await rm(dir,{recursive:true,force:true});}
}
const cny=n=>(Math.floor(n/1000000)+'.'+String(n%1000000).padStart(6,'0'));

test('explicit development admin is unlimited by day/month while rate, old history, IDs and profiles remain intact',()=>fixture(async({env,db,calls,api,send,advance,now})=>{
 const profiles=(await db.prepare('SELECT * FROM personas ORDER BY id').all()).results;
 const owner=await sha256(env.ADMIN_EMAIL),threadId='legacy-thread-fixture';
 const original=[{role:'user',content:'retained legacy history'},{role:'assistant',content:'retained legacy response'}];
 await db.prepare('INSERT INTO ai_threads(id,owner,persona_id,history) VALUES (?,?,?,?)').bind(threadId,owner,'moonlight',JSON.stringify(original)).run();
 await db.prepare('INSERT INTO ai_budget(day,calls) VALUES (?,1)').bind(now().toISOString().slice(0,10)).run();
 const legacyBudget=(await db.prepare('SELECT * FROM ai_budget').all()).results;
 const status=(await api('ai/status')).data;
 assert.equal(status.developmentAdmin,true);assert.equal(status.dailyLimit,null);assert.equal(status.monthlyLimit,null);assert.equal(status.rateLimit,3);
 for(let i=0;i<3;i++){const result=await send({threadId});assert.equal(result.status,200);assert.equal(result.data.remaining,null);}
 assert.equal((await send()).data.error.code,'AI_RATE_LIMIT');assert.equal(calls.length,3);
 advance(60000);assert.equal((await send({threadId})).status,200);
 advance(86400000);assert.equal((await send({threadId})).status,200);
 advance(32*86400000);assert.equal((await send({threadId})).status,200);
 assert.equal(calls.length,6);
 const history=(await api('ai/history?threadId='+threadId)).data.messages;
 assert.deepEqual(history.slice(0,2),original);assert.equal(history.length,14);
 assert.deepEqual((await db.prepare('SELECT * FROM personas ORDER BY id').all()).results,profiles);
 assert.deepEqual((await db.prepare('SELECT * FROM ai_budget').all()).results,legacyBudget);
}));

test('NODE_ENV alone, forged client flags and unauthenticated requests never unlock admin development quota',()=>fixture(async({env,api,send,calls,advance})=>{
 assert.equal((await send({},false)).status,401);
 for(const field of ['role','AI_QUOTA_MODE','developmentAdmin'])assert.equal((await send({[field]:'development'})).status,400);
 delete env.AI_QUOTA_MODE;env.NODE_ENV='development';
 assert.equal((await api('ai/status')).data.developmentAdmin,false);
 assert.equal((await send()).status,200);advance(60000);
 assert.equal((await send()).data.error.code,'AI_DAILY_LIMIT');assert.equal(calls.length,1);
 env.AI_QUOTA_MODE='develop';assert.equal((await api('ai/status')).status,503);
}));

test('configured admin rate is bounded; duplicate/concurrent requests reserve once and preserve locks',()=>fixture(async({env,db,send,api,calls})=>{
 for(const value of ['','0','61','NaN','1.5','Infinity']){env.AI_ADMIN_RATE_LIMIT=value;assert.equal((await api('ai/status')).status,503);}
 env.AI_ADMIN_RATE_LIMIT='2';let started,release;
 const begun=new Promise(r=>started=r),waiting=new Promise(r=>release=r);let n=0;
 const provider={complete:async()=>{n++;started();await waiting;return 'Offline concurrent reply';}};
 const requestId=randomUUID(),body={requestId};
 const first=send(body,true,{provider});await begun;
 assert.equal((await send(body,true,{provider})).data.error.code,'REQUEST_ALREADY_ATTEMPTED');
 assert.equal((await send({},true,{provider})).data.error.code,'AI_BUSY');
 release();const result=await first;assert.equal(result.status,200);
 assert.deepEqual((await send(body,true,{provider})).data,result.data);assert.equal(n,1);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM ai_cost_reservations').first()).n,1);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM ai_locks').first()).n,0);
 assert.equal((await send()).status,200);assert.equal((await send()).data.error.code,'AI_RATE_LIMIT');
}));

test('missing, malformed, mismatched prices/budgets fail closed before claims or provider calls',()=>fixture(async({env,db,send,calls,api})=>{
 const original={...env};
 const required=['AI_COST_DAILY_BUDGET_CNY','AI_COST_MONTHLY_BUDGET_CNY','AI_PRICE_INPUT_CNY_PER_MILLION','AI_PRICE_OUTPUT_CNY_PER_MILLION','AI_PRICE_MODEL','AI_PRICE_BASE_URL','AI_PRICE_TOKEN_BOUND'];
 for(const key of required){delete env[key];assert.equal((await send()).data.error.code,'AI_COST_CONFIG_INVALID');assert.equal((await api('ai/status')).data.costConfigured,false);Object.assign(env,original);}
 for(const value of ['0','-1','NaN','Infinity','1e3','0.0000001','100000000000000000']){
   env.AI_COST_DAILY_BUDGET_CNY=value;assert.equal((await send()).data.error.code,'AI_COST_CONFIG_INVALID');Object.assign(env,original);
 }
 for(const change of [{AI_PRICE_MODEL:'other-model'},{AI_PRICE_BASE_URL:'https://other.example/v1'},{AI_PRICE_TOKEN_BOUND:'guess'}]){
   Object.assign(env,change);assert.equal((await send()).data.error.code,'AI_COST_CONFIG_INVALID');Object.assign(env,original);
 }
 env.AI_ENABLED='false';assert.equal((await send()).data.error.code,'AI_DISABLED');
 assert.equal(calls.length,0);assert.equal((await db.prepare('SELECT count(*) AS n FROM ai_requests').first()).n,0);
}));

test('global money budget persists across reopen, failed upstreams, new days and unbounded admin identity',()=>fixture(async({env,db,send,advance,calls})=>{
 const first=await send();assert.equal(first.status,200);
 const amount=Number((await db.prepare('SELECT reserved_micro_cny FROM ai_cost_reservations').first()).reserved_micro_cny);
 env.AI_COST_MONTHLY_BUDGET_CNY=cny(amount);
 advance(86400000);await closeDatabases();const reopened=await getDatabase(env);
 const result=await send();assert.equal(result.data.error.code,'AI_COST_BUDGET_EXCEEDED');assert.equal(calls.length,1);
 assert.equal((await reopened.prepare('SELECT count(*) AS n FROM ai_cost_periods').first()).n,2);
 assert.equal((await reopened.prepare('SELECT count(*) AS n FROM ai_cost_reservations').first()).n,1);
}));

test('failed provider and post-provider storage error retain conservative charges and cannot retry the request',()=>fixture(async({env,db,send,calls,advance})=>{
 const broken={complete:async()=>{throw Error('private upstream '+env.AI_API_KEY);}};
 const requestId=randomUUID();assert.equal((await send({requestId},true,{provider:broken})).status,500);
 assert.equal((await send({requestId},true,{provider:broken})).status,409);
 const before=(await db.prepare('SELECT * FROM ai_cost_periods ORDER BY kind').all()).results;
 assert.equal(before.every(p=>Number(p.reserved_micro_cny)>0),true);
 const proxy={...db,batch:async statements=>{
   if(statements.some(s=>s.sql.includes('INSERT INTO ai_threads')))throw Error('private storage');
   return db.batch(statements);
 }};env.DB=proxy;advance(60000);
 const result=await send();assert.equal(result.status,500);assert.equal(JSON.stringify(result).includes(env.AI_API_KEY),false);
 const after=(await db.prepare('SELECT * FROM ai_cost_periods ORDER BY kind').all()).results;
 assert.equal(after.every((p,i)=>Number(p.reserved_micro_cny)>Number(before[i].reserved_micro_cny)),true);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM ai_locks').first()).n,0);
}));

test('reservation failure rolls back both financial periods and database unavailability never reaches provider',()=>fixture(async({env,db,send,calls})=>{
 const proxy={...db,batch:async statements=>{
   if(statements.some(s=>s.sql.includes('INSERT INTO ai_cost_reservations')))throw Error('private database outage');
   return db.batch(statements);
 }};env.DB=proxy;
 const result=await send();assert.equal(result.data.error.code,'AI_COST_GUARD_UNAVAILABLE');assert.equal(calls.length,0);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM ai_cost_periods').first()).n,0);
}));

test('Provider requires a persisted, single-use, exact-message/config permit even outside chat handler',()=>fixture(async({env,db})=>{
 let calls=0;const provider=createProvider(env,async()=>{calls++;return Response.json({choices:[{message:{content:'Offline response'}}]});});
 const messages=[{role:'user',content:'fixture'}];
 await assert.rejects(()=>provider.complete(messages),e=>e.code==='AI_COST_RESERVATION_REQUIRED');assert.equal(calls,0);
 let permit=await reserveChatCost(env,db,randomUUID(),messages,256);
 assert.equal(await provider.complete(messages,permit),'Offline response');
 await assert.rejects(()=>provider.complete(messages,permit),e=>e.code==='AI_COST_RESERVATION_REQUIRED');assert.equal(calls,1);
 permit=await reserveChatCost(env,db,randomUUID(),messages,256);
 await assert.rejects(()=>provider.complete([{role:'user',content:'tampered'}],permit),e=>e.code==='AI_COST_RESERVATION_REQUIRED');assert.equal(calls,1);
 permit=await reserveChatCost(env,db,randomUUID(),messages,256);env.AI_PRICE_OUTPUT_CNY_PER_MILLION='3';
 await assert.rejects(()=>provider.complete(messages,permit),e=>e.code==='AI_COST_RESERVATION_REQUIRED');assert.equal(calls,1);
}));

test('last affordable reservation can be taken once across independent request identities',()=>fixture(async({env,db})=>{
 const messages=[{role:'user',content:'fixture'}],amount=estimateCost(env,messages,256).amount;
 env.AI_COST_DAILY_BUDGET_CNY=cny(amount);env.AI_COST_MONTHLY_BUDGET_CNY=cny(amount);
 const results=await Promise.allSettled([reserveChatCost(env,db,randomUUID(),messages,256),reserveChatCost(env,db,randomUUID(),messages,256)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='AI_COST_BUDGET_EXCEEDED').length,1);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM ai_cost_reservations').first()).n,1);
 assert.equal((await db.prepare('SELECT reserved_micro_cny FROM ai_cost_periods WHERE kind=?').bind('month').first()).reserved_micro_cny,amount);
}));

test('outbound payload is immutable and stale Provider configuration cannot use a fresh differently priced permit',()=>fixture(async({env,db})=>{
 let captured,calls=0;
 const provider=createProvider(env,async(_,options)=>{calls++;captured=JSON.parse(options.body);return Response.json({choices:[{message:{content:'Offline'}}]});});
 const messages=[{role:'user',content:'original fixture'}];
 let permit=await reserveChatCost(env,db,randomUUID(),messages,256);
 const pending=provider.complete(messages,permit);messages[0].content='changed after call';
 assert.equal(await pending,'Offline');assert.equal(captured.messages[0].content,'original fixture');
 env.AI_PRICE_OUTPUT_CNY_PER_MILLION='4';
 permit=await reserveChatCost(env,db,randomUUID(),messages,256);
 await assert.rejects(()=>provider.complete(messages,permit),e=>e.code==='AI_COST_RESERVATION_REQUIRED');assert.equal(calls,1);
 const current=createProvider(env,async()=>{calls++;return Response.json({choices:[{message:{content:'must not run'}}]});});
 permit=await reserveChatCost(env,db,randomUUID(),messages,256);
 const disabled=current.complete(messages,permit);env.AI_ENABLED='false';
 await assert.rejects(()=>disabled,e=>e.code==='AI_DISABLED');assert.equal(calls,1);
}));

test('cost migration preserves existing profiles, history, request records and legacy migration checksums',()=>fixture(async({db,env,send})=>{
 assert.equal((await send()).status,200);
 const before=await Promise.all(['personas','ai_threads','ai_requests'].map(async table=>({table,rows:(await db.prepare('SELECT * FROM '+table+' ORDER BY id').all()).results})));
 const journal=(await db.prepare("SELECT * FROM schema_migrations WHERE id<>'0005_chat_cost_guard.sql' ORDER BY id").all()).results;
 await db.prepare('DROP TABLE ai_cost_reservations').run();await db.prepare('DROP TABLE ai_cost_periods').run();
 await db.prepare("DELETE FROM schema_migrations WHERE id='0005_chat_cost_guard.sql'").run();
 await migrateDatabase(db);await initializeData(db);
 for(const item of before)assert.deepEqual((await db.prepare('SELECT * FROM '+item.table+' ORDER BY id').all()).results,item.rows);
 assert.deepEqual((await db.prepare("SELECT * FROM schema_migrations WHERE id<>'0005_chat_cost_guard.sql' ORDER BY id").all()).results,journal);
}));
