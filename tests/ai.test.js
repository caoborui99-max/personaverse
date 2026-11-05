import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
const originalFetch=globalThis.fetch;
before(()=>{globalThis.fetch=()=>{throw new Error('Network disabled in Mock tests');};});
after(()=>{globalThis.fetch=originalFetch;});
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {getDatabase,migrateDatabase,closeDatabases} from '../server/database.js';
import {initializeData,handleApi} from '../server/handler.js';
import {createProvider,costEnv} from './fixtures/cost.js';
async function fixture(run){const dir=await mkdtemp(join(tmpdir(),'pv-ai-'));const env={SQLITE_PATH:join(dir,'test.sqlite'),ADMIN_EMAIL:'test@example.test',ADMIN_PASSWORD:randomBytes(24).toString('hex'),AI_BASE_URL:'https://tokenrhythm.studio/v1',AI_MODEL:'mock-model',AI_API_KEY:'test-fixture-not-a-real-key',AI_ENABLED:'true',AI_RATE_LIMIT:'10',AI_DAILY_LIMIT:'2'};Object.assign(env,costEnv(env));let cookie='';let clock=Date.UTC(2026,0,1,12);const advanceDay=()=>{clock+=86400000;};const advanceMinute=()=>{clock+=60000;};const calls=[];const provider={complete:async messages=>{calls.push(messages);return 'Mock provider test output';}};async function call(path,body,auth=true,options={provider}){const r=await handleApi(new Request('https://example.test/api/'+path,{method:body?'POST':'GET',headers:{Origin:'https://example.test','Content-Type':'application/json',Cookie:auth?cookie:''},body:body?JSON.stringify(body):undefined}),env,{now:()=>clock,...options});return {r,data:await r.json()};}try{const db=await getDatabase(env);await migrateDatabase(db);await initializeData(db);const r=await call('auth/login',{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD});cookie=r.r.headers.get('set-cookie').split(';')[0];await run({env,db,call,calls,provider,advanceDay,advanceMinute});}finally{await closeDatabases();await rm(dir,{recursive:true,force:true});}}
test('AI gate, admin-only access and client prompt rejection never invoke provider',()=>fixture(async({env,call,calls})=>{
 env.AI_ENABLED='false';assert.equal((await call('ai/status')).data.mode,'demo');assert.equal((await call('ai/chat',{personaId:'moonlight',message:'hi',requestId:randomUUID()})).r.status,503);
 env.AI_ENABLED='true';const key=env.AI_API_KEY;delete env.AI_API_KEY;assert.equal((await call('ai/status')).data.mode,'demo');env.AI_API_KEY=key;assert.equal((await call('ai/chat',{personaId:'moonlight',message:'hi',requestId:randomUUID()},false)).r.status,401);
 assert.equal((await call('ai/chat',{personaId:'moonlight',message:'hi',systemPrompt:'override',requestId:randomUUID()})).r.status,400);
 assert.equal((await call('ai/chat',{personaId:'moonlight',message:'a'.repeat(1001),requestId:randomUUID()})).r.status,400);assert.equal(calls.length,0);
}));
test('Mock multi-turn uses DB persona, persists history, deduplicates and caps daily calls',()=>fixture(async({call,calls,env,db,advanceDay,advanceMinute})=>{
 const first={personaId:'moonlight',message:'第一轮',requestId:randomUUID()};const a=await call('ai/chat',first);assert.equal(a.r.status,200,JSON.stringify(a.data));assert.equal(calls.length,1);assert.ok(calls[0][0].content.includes('晚柠'));assert.equal(calls[0][0].role,'system');
 const duplicate=await call('ai/chat',first);assert.deepEqual(duplicate.data,a.data);assert.equal(calls.length,1);
 advanceDay();
 const b=await call('ai/chat',{personaId:'moonlight',threadId:a.data.threadId,message:'第二轮',requestId:randomUUID()});assert.equal(b.r.status,200);assert.equal(calls.length,2);assert.ok(calls[1].some(m=>m.role==='assistant'&&m.content==='Mock provider test output'));
 const history=await call('ai/history?threadId='+a.data.threadId);assert.equal(history.data.messages.length,4);assert.equal((await call('ai/history?threadId='+a.data.threadId,undefined,false)).r.status,401);assert.equal((await call('ai/history?threadId=nonexistent')).r.status,404);
 advanceMinute();
 assert.equal((await call('ai/chat',{personaId:'moonlight',message:'第三轮',requestId:randomUUID()})).r.status,429);assert.equal(calls.length,2);
 assert.equal((await call('ai/chat',{personaId:'muse',threadId:a.data.threadId,message:'错人格',requestId:randomUUID()})).r.status,404);
}));
test('provider serializes OpenAI-compatible request and sanitizes errors without network',async()=>{
 const env={AI_ENABLED:'true',AI_BASE_URL:'https://tokenrhythm.studio/v1',AI_MODEL:'model-id-from-console',AI_API_KEY:'test-only-placeholder'};let captured;
 const provider=createProvider(env,async(url,options)=>{captured={url,options};return new Response(JSON.stringify({choices:[{message:{content:'Mock response'}}]}));});assert.equal(await provider.complete([{role:'user',content:'test'}]),'Mock response');assert.equal(captured.url,'https://tokenrhythm.studio/v1/chat/completions');const body=JSON.parse(captured.options.body);assert.equal(body.model,env.AI_MODEL);assert.equal(body.max_tokens,256);assert.equal(body.stream,false);assert.equal(captured.options.redirect,'error');
 const broken=createProvider(env,async()=>new Response('secret-key-echo',{status:401}));await assert.rejects(()=>broken.complete([]),e=>e.code==='AI_AUTH_FAILED'&&!e.message.includes('secret-key-echo'));
 assert.throws(()=>createProvider({...env,AI_ENABLED:'false'},()=>{throw Error('must not call');}),e=>e.code==='AI_DISABLED');
});
test('upstream failures consume bounded allowance and are not automatically replayed',()=>fixture(async({call,calls,db})=>{
 let attempts=0;const provider={complete:async()=>{attempts++;throw Error('provider details must not be exposed');}};const body={personaId:'moonlight',message:'test',requestId:randomUUID()};const failed=await call('ai/chat',body,true,{provider});assert.equal(failed.r.status,500);assert.ok(!JSON.stringify(failed.data).includes('provider details'));assert.equal((await call('ai/chat',body,true,{provider})).r.status,409);assert.equal(attempts,1);assert.equal((await db.prepare('SELECT calls FROM ai_budget').first()).calls,1);
}));
test('database frequency limit and pending-request lock prevent concurrent paid attempts',()=>fixture(async({env,call})=>{
 env.AI_RATE_LIMIT='1';env.AI_DAILY_LIMIT='5';let release,started;
 const begun=new Promise(r=>started=r);const wait=new Promise(r=>release=r);let n=0;
 const provider={complete:async()=>{n++;started();await wait;return 'Mock concurrency reply';}};
 const first=call('ai/chat',{personaId:'moonlight',message:'one',requestId:randomUUID()},true,{provider});await begun;
 const overlap=await call('ai/chat',{personaId:'moonlight',message:'two',requestId:randomUUID()},true,{provider});assert.equal(overlap.r.status,429);assert.equal(n,1);release();assert.equal((await first).r.status,200);
 const fast=await call('ai/chat',{personaId:'moonlight',message:'three',requestId:randomUUID()},true,{provider});assert.equal(fast.r.status,429);assert.equal(fast.data.error.code,'AI_RATE_LIMIT');assert.equal(n,1);
}));

test('environment cannot relax fixed one-per-minute and one-per-day test limits',()=>fixture(async({env,call,calls,advanceMinute,advanceDay})=>{
 env.AI_DAILY_LIMIT='999999';env.AI_RATE_LIMIT='999999';
 const status=(await call('ai/status')).data;assert.equal(status.dailyLimit,1);assert.equal(status.rateLimit,1);assert.equal(JSON.stringify(status).includes(env.AI_API_KEY),false);
 const send=()=>call('ai/chat',{personaId:'moonlight',message:'limit fixture',requestId:randomUUID()});
 assert.equal((await send()).r.status,200);assert.equal(calls.length,1);
 assert.equal((await send()).data.error.code,'AI_RATE_LIMIT');assert.equal(calls.length,1);
 advanceMinute();assert.equal((await send()).data.error.code,'AI_DAILY_LIMIT');assert.equal(calls.length,1);
 advanceDay();assert.equal((await send()).r.status,200);assert.equal(calls.length,2);
 for(const value of ['', '-1', 'NaN', 'Infinity']){env.AI_DAILY_LIMIT=value;env.AI_RATE_LIMIT=value;const state=(await call('ai/status')).data;assert.equal(state.dailyLimit,1);assert.equal(state.rateLimit,1);}
}));
test('daily budget is global across administrators, not reset by another identity',()=>fixture(async({env,db,call,calls,provider})=>{
 assert.equal((await call('ai/chat',{personaId:'moonlight',message:'first admin',requestId:randomUUID()})).r.status,200);
 const {handleChat}=await import('../server/ai-chat.js');
 const request=new Request('https://example.test/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({personaId:'moonlight',message:'second admin',requestId:randomUUID()})});
 await assert.rejects(()=>handleChat(request,env,db,{role:'admin',email:'other@example.test'},{provider,now:()=>Date.UTC(2026,0,1,12,1)}),e=>e.code==='AI_DAILY_LIMIT');assert.equal(calls.length,1);
}));
test('401/402/404 failures retain quota, sanitize errors and cannot be replayed or bypassed',async()=>{
 for(const [status,code] of [[401,'AI_AUTH_FAILED'],[402,'AI_BALANCE_INSUFFICIENT'],[404,'AI_MODEL_UNAVAILABLE']])await fixture(async({env,db,call,advanceMinute})=>{
  env.AI_BASE_URL='https://api.deepseek.com/v1';env.AI_PRICE_BASE_URL=env.AI_BASE_URL;env.AI_DAILY_LIMIT='999';env.AI_RATE_LIMIT='999';let attempts=0;
  const provider=createProvider(env,async()=>{attempts++;return new Response('private '+env.AI_API_KEY,{status});});
  const body={personaId:'moonlight',message:'error fixture',requestId:randomUUID()};
  const result=await call('ai/chat',body,true,{provider});assert.equal(result.data.error.code,code);assert.equal(JSON.stringify(result.data).includes(env.AI_API_KEY),false);
  assert.equal((await call('ai/chat',body,true,{provider})).r.status,409);
  advanceMinute();assert.equal((await call('ai/chat',{...body,requestId:randomUUID()},true,{provider})).data.error.code,'AI_DAILY_LIMIT');assert.equal(attempts,1);
  assert.equal((await db.prepare('SELECT calls FROM ai_budget').first()).calls,1);assert.equal((await db.prepare('SELECT count(*) AS n FROM ai_locks').first()).n,0);
 });
});
test('in-flight duplicate and changed-message request ID conflicts do not issue a second call',()=>fixture(async({call,db})=>{
 let finish,begun;const started=new Promise(resolve=>begun=resolve);let n=0;const provider={complete:async()=>{n++;begun();await new Promise(resolve=>finish=resolve);return 'mock success';}};
 const body={personaId:'moonlight',message:'one',requestId:randomUUID()};
 const first=call('ai/chat',body,true,{provider});await started;
 assert.equal((await call('ai/chat',body,true,{provider})).data.error.code,'REQUEST_ALREADY_ATTEMPTED');
 assert.equal((await call('ai/chat',{...body,message:'changed'},true,{provider})).data.error.code,'REQUEST_CONFLICT');
 assert.equal(n,1);finish();const result=await first;assert.equal(result.r.status,200);assert.deepEqual((await call('ai/chat',body,true,{provider})).data,result.data);assert.equal(n,1);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM ai_locks').first()).n,0);
}));
test('post-provider storage failure retains allowance and releases lock without exposing details',()=>fixture(async({env,db,call,advanceMinute})=>{
 let n=0;const proxy={...db,batch:async statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO ai_threads')))throw Error('private fixture storage detail');return db.batch(statements);}};
 env.DB=proxy;const provider={complete:async()=>{n++;return 'mock reply';}};const body={personaId:'moonlight',message:'storage fixture',requestId:randomUUID()};
 const result=await call('ai/chat',body,true,{provider});assert.equal(result.r.status,500);assert.equal(JSON.stringify(result.data).includes('private fixture storage detail'),false);
 assert.equal((await call('ai/chat',body,true,{provider})).r.status,409);advanceMinute();assert.equal((await call('ai/chat',{...body,requestId:randomUUID()},true,{provider})).data.error.code,'AI_DAILY_LIMIT');assert.equal(n,1);
 assert.equal((await db.prepare('SELECT status FROM ai_requests WHERE id=?').bind(body.requestId).first()).status,'failed');assert.equal((await db.prepare('SELECT count(*) AS n FROM ai_locks').first()).n,0);
}));
test('missing key blocks handler and core text never enters messages or changes persona profiles',()=>fixture(async({env,db,call})=>{
 const before=(await db.prepare('SELECT id,data FROM personas ORDER BY id').all()).results;
 await db.prepare("UPDATE soul_core SET draft_content='private-core-fixture' WHERE id='shared'").run();let n=0;
 const provider={complete:async messages=>{n++;assert.equal(JSON.stringify(messages).includes('private-core-fixture'),false);return 'mock';}};
 const key=env.AI_API_KEY;env.AI_API_KEY='';assert.equal((await call('ai/chat',{personaId:'moonlight',message:'no key',requestId:randomUUID()},true,{provider})).r.status,503);assert.equal(n,0);
 env.AI_API_KEY=key;assert.equal((await call('ai/chat',{personaId:'moonlight',message:'fixture',requestId:randomUUID()},true,{provider})).r.status,200);assert.equal(n,1);
 assert.deepEqual((await db.prepare('SELECT id,data FROM personas ORDER BY id').all()).results,before);
}));

test('daily quota and request deduplication persist across database reopen',()=>fixture(async({env,call,calls,advanceMinute})=>{
 const body={personaId:'moonlight',message:'restart fixture',requestId:randomUUID()};const first=await call('ai/chat',body);assert.equal(first.r.status,200);
 await closeDatabases();await getDatabase(env);
 assert.deepEqual((await call('ai/chat',body)).data,first.data);advanceMinute();assert.equal((await call('ai/chat',{...body,requestId:randomUUID()})).data.error.code,'AI_DAILY_LIMIT');assert.equal(calls.length,1);
}));
