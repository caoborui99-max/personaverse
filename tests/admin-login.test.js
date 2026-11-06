import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import nodeApi from '../api/index.js';
import {getDatabase,migrateDatabase,closeDatabases} from '../server/database.js';
import {initializeData,handleApi} from '../server/handler.js';

async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'pv-admin-login-'));
 const env={NODE_ENV:'test',SQLITE_PATH:join(dir,'fixture.sqlite'),ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:randomBytes(24).toString('hex'),AI_ENABLED:'false'};
 const keys=['NODE_ENV','VERCEL','APP_ORIGIN','TRUST_PROXY','SQLITE_PATH','DATABASE_URL','DATABASE_DRIVER','ADMIN_EMAIL','ADMIN_PASSWORD','AI_ENABLED'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const db=await getDatabase(env);await migrateDatabase(db);await initializeData(db);
 async function request(path,{method='GET',body,cookie='',origin='https://app.example.test',forwarded='https',remote='127.0.0.1'}={}){
   for(const key of keys)delete process.env[key];Object.assign(process.env,env);
   const headers={host:'app.example.test','x-forwarded-proto':forwarded,origin,'content-type':'application/json',cookie};
   const req={url:'/api/'+path,method,headers,body,socket:{remoteAddress:remote}};
   const out={headers:{},statusCode:0,setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(bytes){this.data=JSON.parse(Buffer.from(bytes).toString());}};
   await nodeApi(req,out);return out;
 }
 try{await run({env,db,request});}
 finally{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}await closeDatabases();await rm(dir,{recursive:true,force:true});}
}

test('reproduces HTTPS proxy 403 before credential validation; fixed explicit origin permits secure login/logout',()=>fixture(async({env,db,request})=>{
 const body={email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD};
 const failure=await request('auth/login',{method:'POST',body});
 assert.equal(failure.statusCode,403);assert.equal(failure.data.error.code,'ORIGIN_REJECTED');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM login_attempts').first()).n,0);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM sessions').first()).n,0);
 env.APP_ORIGIN='https://app.example.test';env.TRUST_PROXY='loopback';
 const before=(await db.prepare('SELECT id,data FROM personas ORDER BY id').all()).results;
 const logged=await request('auth/login',{method:'POST',body});assert.equal(logged.statusCode,200);
 assert.equal(logged.data.user.role,'admin');
 const cookie=logged.headers['set-cookie'][0];assert.match(cookie,/HttpOnly; SameSite=Strict; Path=\/; Max-Age=86400; Secure/);
 const value=cookie.split(';')[0];
 assert.equal((await request('session',{cookie:value})).data.user.role,'admin');
 assert.equal((await request('admin/personas',{cookie:value})).statusCode,200);
 assert.equal((await request('admin/personas')).statusCode,401);
 assert.equal((await request('auth/logout',{method:'POST',body:{},cookie:value})).statusCode,200);
 assert.equal((await request('session',{cookie:value})).data.user,null);
 assert.equal((await request('admin/personas',{cookie:value})).statusCode,401);
 assert.deepEqual((await db.prepare('SELECT id,data FROM personas ORDER BY id').all()).results,before);
}));

test('wrong password, cross-origin and untrusted proxy stay rejected without session creation',()=>fixture(async({env,db,request})=>{
 env.APP_ORIGIN='https://app.example.test';env.TRUST_PROXY='loopback';
 const body={email:env.ADMIN_EMAIL,password:'synthetic-wrong-password'};
 assert.equal((await request('auth/login',{method:'POST',body})).data.error.code,'INVALID_CREDENTIALS');
 body.password=env.ADMIN_PASSWORD;
 assert.equal((await request('auth/login',{method:'POST',body,origin:'https://evil.example.test'})).statusCode,403);
 assert.equal((await request('auth/login',{method:'POST',body,remote:'203.0.113.10'})).data.error.code,'PROXY_REJECTED');
 assert.equal((await request('auth/login',{method:'POST',body,forwarded:'http'})).data.error.code,'PROXY_SCHEME_REJECTED');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM sessions').first()).n,0);
}));

test('bootstrap admin comes from server environment; credential changes and expired cookies invalidate sessions',()=>fixture(async({env,db,request})=>{
 env.APP_ORIGIN='https://app.example.test';env.TRUST_PROXY='loopback';
 const login=await request('auth/login',{method:'POST',body:{email:' ADMIN@EXAMPLE.TEST ',password:env.ADMIN_PASSWORD}});
 assert.equal(login.statusCode,200);const cookie=login.headers['set-cookie'][0].split(';')[0];
 const record=await db.prepare('SELECT token_hash,credential_hash FROM sessions').first();
 assert.equal(record.token_hash.includes(cookie.split('=')[1]),false);assert.equal(record.credential_hash.includes(env.ADMIN_PASSWORD),false);
 const original=env.ADMIN_PASSWORD;env.ADMIN_PASSWORD=randomBytes(24).toString('hex');
 assert.equal((await request('session',{cookie})).data.user,null);env.ADMIN_PASSWORD=original;
 await db.prepare('UPDATE sessions SET expires_at=?').bind('2000-01-01T00:00:00.000Z').run();
 assert.equal((await request('admin/personas',{cookie})).statusCode,401);
}));

test('missing admin config, missing database and malformed login requests are distinct failures',()=>fixture(async({env,request})=>{
 env.APP_ORIGIN='https://app.example.test';env.TRUST_PROXY='loopback';
 const body={email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD};
 delete env.ADMIN_PASSWORD;assert.equal((await request('auth/login',{method:'POST',body})).data.error.code,'ADMIN_NOT_CONFIGURED');
 env.ADMIN_PASSWORD=body.password;
 assert.equal((await request('auth/login',{method:'POST',body:{email:body.email,password:123}})).statusCode,400);
 assert.equal((await request('auth/login')).statusCode,404);
 env.SQLITE_PATH=join(tmpdir(),'pv-missing-'+randomBytes(8).toString('hex')+'.sqlite');
 assert.equal((await request('auth/login',{method:'POST',body})).data.error.code,'MIGRATION_REQUIRED');
}));

test('database failures expose a correlation ID and safe code, never error messages, credentials or tokens',async(t)=>fixture(async({env,db})=>{
 const logs=[];t.mock.method(console,'error',(tag,entry)=>logs.push({tag,...entry}));
 env.DB={...db,prepare(sql){
  if(sql.includes('INSERT INTO login_attempts'))throw Object.assign(Error('private detail '+env.ADMIN_PASSWORD),{code:'SQLITE_READONLY',name:'private-'+env.ADMIN_PASSWORD});
  return db.prepare(sql);
 }};
 const response=await handleApi(new Request('https://app.example.test/api/auth/login',{method:'POST',headers:{Origin:'https://app.example.test','Content-Type':'application/json'},body:JSON.stringify({email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD})}),env);
 const data=await response.json();assert.equal(response.status,500);assert.equal(logs.length,1);
 assert.equal(logs[0].code,'SQLITE_READONLY');assert.equal(logs[0].operation,'admin_login');
 assert.equal(data.error.requestId,response.headers.get('x-request-id'));assert.equal(data.error.requestId,logs[0].requestId);
 const text=JSON.stringify({data,logs});assert.equal(text.includes(env.ADMIN_PASSWORD),false);assert.equal(text.includes(env.ADMIN_EMAIL),false);assert.equal(text.includes('private detail'),false);
}));

test('proxy configuration errors retain actionable safe messages and never trust a forged HTTPS header',()=>fixture(async({env,request})=>{
 env.NODE_ENV='production';
 const result=await request('auth/login',{method:'POST',body:{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD}});
 assert.equal(result.statusCode,503);assert.equal(result.data.error.code,'ORIGIN_NOT_CONFIGURED');assert.match(result.data.error.message,/APP_ORIGIN/);
}));

test('a real SQLite read-only write error is safely classified rather than mistaken for wrong credentials',async(t)=>fixture(async({env,db})=>{
 const {DatabaseSync}=await import('node:sqlite');const readonly=new DatabaseSync(env.SQLITE_PATH,{readOnly:true});
 const execute=db.execute;const logs=[];t.mock.method(console,'error',(tag,entry)=>logs.push(entry));
 db.execute=async(sql,params=[])=>{if(sql.includes('INSERT INTO login_attempts'))return readonly.prepare(sql).get(...params);return execute(sql,params);};
 try{
  const response=await handleApi(new Request('https://app.example.test/api/auth/login',{method:'POST',headers:{Origin:'https://app.example.test','Content-Type':'application/json'},body:JSON.stringify({email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD})}),env);
  assert.equal(response.status,500);assert.equal((await response.json()).error.code,'SERVER_ERROR');assert.equal(logs[0].code,'SQLITE_READONLY');
 }finally{db.execute=execute;readonly.close();}
}));

const source=await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function browser({sessionMode='normal',listFailure=false}={}){
 let authenticated=false;const calls=[];
 const elements=new Map();
 function element(id){if(!elements.has(id))elements.set(id,{hidden:id==='#panel',disabled:false,textContent:'',value:'',children:[],elements:{},reset(){},replaceChildren(){this.children=[];},append(...items){this.children.push(...items);},close(){this.open=false;},querySelector(){return button;}});return elements.get(id);}
 const button={disabled:false};
 const form=element('#login');form.elements={email:{value:'admin@example.test'},password:{value:'synthetic-local-password'}};
 const fetcher=async(path,options={})=>{
   const route=path.replace('./api/','').split('?')[0];calls.push({route,method:options.method});
   if(route==='auth/login'){authenticated=true;return Response.json({user:{role:'admin'}});}
   if(route==='auth/logout'){authenticated=false;return Response.json({ok:true});}
   if(route==='session'){
     if(authenticated&&sessionMode==='error')throw Error('fixture session unavailable');
     return Response.json({user:authenticated&&sessionMode!=='lost'?{role:'admin'}:null,config:{databaseReady:true}});
   }
   if(route==='admin/personas')return listFailure?Response.json({error:{code:'ADMIN_REQUIRED',message:'fixture list unavailable'}},{status:401}):Response.json({personas:[],categories:[],pages:1});
   throw Error('Unexpected fixture route');
 };
 const context={document:{querySelector:element,createElement:()=>element('created')},window:{PersonaVerseHTTP:{fetch:fetcher}},URLSearchParams,FormData:class {},setTimeout,clearTimeout,confirm:()=>false};
 runInNewContext(source,context,{timeout:1000});await flush();
 return {element,form,button,calls,submit:async(withSubmitter=true)=>{await form.onsubmit({preventDefault(){},currentTarget:form,submitter:withSubmitter?button:null});await flush();}};
}

test('frontend does not report successful login when the browser has no authenticated session',async()=>{
 const ui=await browser({sessionMode:'lost'});await ui.submit();
 assert.equal(ui.element('#panel').hidden,true);assert.equal(ui.element('#login').hidden,false);
 assert.match(ui.element('#notice').textContent,/未建立|会话未确认/);
 assert.notEqual(ui.element('#notice').textContent,'登录成功');
});
test('frontend preserves session/list failures instead of overwriting them with login success',async()=>{
 for(const options of [{sessionMode:'error'},{listFailure:true}]){
   const ui=await browser(options);await ui.submit();
   assert.match(ui.element('#notice').textContent,/fixture/);assert.equal(ui.element('#panel').hidden,true);
 }
});
test('frontend handles submission with no submitter and opens the existing panel without a redirect',async()=>{
 const ui=await browser();await ui.submit(false);
 assert.equal(ui.element('#panel').hidden,false);assert.equal(ui.element('#login').hidden,true);
 assert.equal(ui.element('#notice').textContent,'登录成功');assert.equal(ui.button.disabled,false);
 assert.equal(ui.calls.some(c=>c.route==='admin/personas'),true);
});
test('frontend logout verifies a guest session and hides the protected panel',async()=>{
 const ui=await browser();await ui.submit();await ui.element('#logout').onclick();await flush();
 assert.equal(ui.element('#panel').hidden,true);assert.equal(ui.element('#login').hidden,false);
 assert.equal(ui.element('#list').children.length,0);
});
