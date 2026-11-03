import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {getDatabase,migrateDatabase,closeDatabases} from '../server/database.js';
import {initializeData,handleApi} from '../server/handler.js';
import {createProvider} from '../server/ai-provider.js';
async function fixture(run){const dir=await mkdtemp(join(tmpdir(),'pv-ai-'));const env={SQLITE_PATH:join(dir,'test.sqlite'),ADMIN_EMAIL:'test@example.test',ADMIN_PASSWORD:randomBytes(24).toString('hex'),AI_BASE_URL:'https://tokenrhythm.studio/v1',AI_MODEL:'mock-model',AI_API_KEY:'test-fixture-not-a-real-key',AI_ENABLED:'true',AI_RATE_LIMIT:'10',AI_DAILY_LIMIT:'2'};let cookie='';const calls=[];const provider={complete:async messages=>{calls.push(messages);return 'Mock provider test output';}};async function call(path,body,auth=true,options={provider}){const r=await handleApi(new Request('https://example.test/api/'+path,{method:body?'POST':'GET',headers:{Origin:'https://example.test','Content-Type':'application/json',Cookie:auth?cookie:''},body:body?JSON.stringify(body):undefined}),env,options);return {r,data:await r.json()};}try{const db=await getDatabase(env);await migrateDatabase(db);await initializeData(db);const r=await call('auth/login',{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD});cookie=r.r.headers.get('set-cookie').split(';')[0];await run({env,db,call,calls,provider});}finally{await closeDatabases();await rm(dir,{recursive:true,force:true});}}
test('AI gate, admin-only access and client prompt rejection never invoke provider',()=>fixture(async({env,call,calls})=>{
 env.AI_ENABLED='false';assert.equal((await call('ai/status')).data.mode,'demo');assert.equal((await call('ai/chat',{personaId:'moonlight',message:'hi',requestId:randomUUID()})).r.status,503);
 env.AI_ENABLED='true';const key=env.AI_API_KEY;delete env.AI_API_KEY;assert.equal((await call('ai/status')).data.mode,'demo');env.AI_API_KEY=key;assert.equal((await call('ai/chat',{personaId:'moonlight',message:'hi',requestId:randomUUID()},false)).r.status,401);
 assert.equal((await call('ai/chat',{personaId:'moonlight',message:'hi',systemPrompt:'override',requestId:randomUUID()})).r.status,400);
 assert.equal((await call('ai/chat',{personaId:'moonlight',message:'a'.repeat(1001),requestId:randomUUID()})).r.status,400);assert.equal(calls.length,0);
}));
test('Mock multi-turn uses DB persona, persists history, deduplicates and caps daily calls',()=>fixture(async({call,calls,env,db})=>{
 const first={personaId:'moonlight',message:'第一轮',requestId:randomUUID()};const a=await call('ai/chat',first);assert.equal(a.r.status,200,JSON.stringify(a.data));assert.equal(calls.length,1);assert.ok(calls[0][0].content.includes('月白'));assert.equal(calls[0][0].role,'system');
 const duplicate=await call('ai/chat',first);assert.deepEqual(duplicate.data,a.data);assert.equal(calls.length,1);
 const b=await call('ai/chat',{personaId:'moonlight',threadId:a.data.threadId,message:'第二轮',requestId:randomUUID()});assert.equal(b.r.status,200);assert.equal(calls.length,2);assert.ok(calls[1].some(m=>m.role==='assistant'&&m.content==='Mock provider test output'));
 const history=await call('ai/history?threadId='+a.data.threadId);assert.equal(history.data.messages.length,4);assert.equal((await call('ai/history?threadId='+a.data.threadId,undefined,false)).r.status,401);assert.equal((await call('ai/history?threadId=nonexistent')).r.status,404);
 assert.equal((await call('ai/chat',{personaId:'moonlight',message:'第三轮',requestId:randomUUID()})).r.status,429);assert.equal(calls.length,2);
 assert.equal((await call('ai/chat',{personaId:'muse',threadId:a.data.threadId,message:'错人格',requestId:randomUUID()})).r.status,404);
}));
test('provider serializes OpenAI-compatible request and sanitizes errors without network',async()=>{
 const env={AI_ENABLED:'true',AI_BASE_URL:'https://tokenrhythm.studio/v1',AI_MODEL:'model-id-from-console',AI_API_KEY:'test-only-placeholder'};let captured;
 const provider=createProvider(env,async(url,options)=>{captured={url,options};return new Response(JSON.stringify({choices:[{message:{content:'Mock response'}}]}));});assert.equal(await provider.complete([{role:'user',content:'test'}]),'Mock response');assert.equal(captured.url,'https://tokenrhythm.studio/v1/chat/completions');const body=JSON.parse(captured.options.body);assert.equal(body.model,env.AI_MODEL);assert.equal(body.max_tokens,256);assert.equal(body.stream,false);assert.equal(captured.options.redirect,'error');
 const broken=createProvider(env,async()=>new Response('secret-key-echo',{status:401}));await assert.rejects(()=>broken.complete([]),e=>e.code==='AI_UPSTREAM_FAILED'&&!e.message.includes('secret-key-echo'));
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
