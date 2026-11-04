import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
const originalFetch=globalThis.fetch;
before(()=>{globalThis.fetch=()=>{throw new Error('Network disabled in Mock tests');};});
after(()=>{globalThis.fetch=originalFetch;});
import {aiConfiguration,createProvider,providerLimits} from '../server/ai-provider.js';
// Synthetic fixture only. Every test injects a local mock; global fetch is never used.
const env={AI_ENABLED:'true',AI_BASE_URL:'https://api.deepseek.com/v1',AI_MODEL:'fixture-model-from-server',AI_API_KEY:'fixture-not-a-real-key',AI_MAX_OUTPUT_TOKENS:'16'};
test('DeepSeek compatible request uses server model, exact endpoint, small token cap and no streaming',async()=>{
 let calls=0;
 const provider=createProvider(env,async(url,options)=>{calls++;assert.equal(url,'https://api.deepseek.com/v1/chat/completions');assert.equal(options.redirect,'error');assert.equal(options.signal.aborted,false);const body=JSON.parse(options.body);assert.equal(body.model,env.AI_MODEL);assert.equal(body.max_tokens,16);assert.equal(body.stream,false);assert.equal(options.headers.Authorization,'Bearer '+env.AI_API_KEY);return Response.json({choices:[{message:{content:'OK'}}]});});
 assert.equal(await provider.complete([{role:'user',content:'test fixture'}]),'OK');assert.equal(calls,1);
});
test('disabled, missing key/model/address and invalid token limits never reach fetch',()=>{
 let calls=0;const mock=async()=>{calls++;throw Error('must not call');};
 for(const field of ['AI_API_KEY','AI_MODEL','AI_BASE_URL']){const copy={...env,[field]:''};assert.equal(aiConfiguration(copy).mode,'demo');assert.throws(()=>createProvider(copy,mock),e=>e.code==='AI_DISABLED');}
 assert.throws(()=>createProvider({...env,AI_ENABLED:'false'},mock),e=>e.code==='AI_DISABLED');
 for(const config of [{AI_MAX_OUTPUT_TOKENS:'257'},{AI_MAX_OUTPUT_TOKENS:'0'},{AI_TIMEOUT_MS:'20001'},{AI_MODEL:'invalid model'},{AI_BASE_URL:'http://api.deepseek.com/v1'}])assert.throws(()=>createProvider({...env,...config},mock),e=>e.code==='AI_CONFIG_INVALID');
 assert.deepEqual(providerLimits({}),{maxTokens:256,timeoutMs:20000});assert.equal(calls,0);
});
test('auth, balance, model, rate limit and server errors are sanitized and never retried',async()=>{
 for(const [status,code] of [[400,'AI_UPSTREAM_FAILED'],[422,'AI_UPSTREAM_FAILED'],[401,'AI_AUTH_FAILED'],[402,'AI_BALANCE_INSUFFICIENT'],[404,'AI_MODEL_UNAVAILABLE'],[429,'AI_UPSTREAM_RATE_LIMIT'],[500,'AI_UPSTREAM_FAILED'],[503,'AI_UPSTREAM_UNAVAILABLE']]){
  let calls=0;const provider=createProvider(env,async()=>{calls++;return new Response('sensitive-upstream-body',{status});});
  await assert.rejects(()=>provider.complete([]),e=>e.code===code&&!e.message.includes('sensitive-upstream-body')&&!e.message.includes(env.AI_API_KEY));assert.equal(calls,1);
 }
});
test('abort timeout is enforced without retry; mock deliberately waits for signal',async()=>{
 let calls=0;const keepAlive=setTimeout(()=>{},1000);
 try{const provider=createProvider({...env,AI_TIMEOUT_MS:'10'},async(_,options)=>{calls++;return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('private transport detail')),{once:true});});});await assert.rejects(()=>provider.complete([]),e=>e.code==='AI_TIMEOUT'&&e.status===504);assert.equal(calls,1);}finally{clearTimeout(keepAlive);}
});
test('malformed, empty and oversized responses fail closed with no request loop',async()=>{
 for(const response of [new Response('not-json'),Response.json({choices:[]}),Response.json({choices:[{message:{content:''}}]}),new Response(null,{status:204}),new Response('x'.repeat(131073))]){
  let calls=0;const provider=createProvider(env,async()=>{calls++;return response;});await assert.rejects(()=>provider.complete([]),e=>e.code==='AI_RESPONSE_INVALID');assert.equal(calls,1);
 }
});

test('single-request tool requires confirmation, config, official endpoint and private attempt state',async()=>{
 const {runDeepSeekOnce}=await import('../server/deepseek-smoke.js');
 const {mkdtemp,rm,readFile}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const dir=await mkdtemp(join(tmpdir(),'pv-deepseek-once-'));let calls=0;
 const fetcher=async(_,options)=>{calls++;assert.equal(JSON.parse(options.body).max_tokens,16);return Response.json({choices:[{message:{content:'OK'}}]});};
 try{
  const config={...env,AI_TEST_STATE_DIR:dir};
  await assert.rejects(()=>runDeepSeekOnce(config,{fetcher}),e=>e.code==='CONFIRMATION_REQUIRED');
  await assert.rejects(()=>runDeepSeekOnce({...config,AI_API_KEY:''},{confirmed:true,fetcher}),e=>e.code==='AI_DISABLED');
  await assert.rejects(()=>runDeepSeekOnce({...config,AI_BASE_URL:'https://other.example/v1'},{confirmed:true,fetcher}),e=>e.code==='AI_CONFIG_INVALID');
  assert.equal(calls,0);
  await runDeepSeekOnce(config,{confirmed:true,fetcher});assert.equal(calls,1);
  await assert.rejects(()=>runDeepSeekOnce(config,{confirmed:true,fetcher}),e=>e.code==='AI_TEST_ALREADY_ATTEMPTED');assert.equal(calls,1);
  const marker=await readFile(join(dir,'deepseek-first-attempt.json'),'utf8');assert.equal(marker.includes(env.AI_API_KEY),false);assert.equal(marker.includes('OK'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('single-request failure keeps durable attempt marker and cannot loop on authentication errors',async()=>{
 const {runDeepSeekOnce}=await import('../server/deepseek-smoke.js');const {mkdtemp,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const dir=await mkdtemp(join(tmpdir(),'pv-deepseek-failure-'));let calls=0;const fetcher=async()=>{calls++;return new Response('private failure',{status:401});};
 try{const options={confirmed:true,fetcher};const config={...env,AI_TEST_STATE_DIR:dir};await assert.rejects(()=>runDeepSeekOnce(config,options),e=>e.code==='AI_AUTH_FAILED');await assert.rejects(()=>runDeepSeekOnce(config,options),e=>e.code==='AI_TEST_ALREADY_ATTEMPTED');assert.equal(calls,1);}finally{await rm(dir,{recursive:true,force:true});}
});


test('transport details are hidden and a delayed response body also observes timeout',async()=>{
 let calls=0;
 await assert.rejects(()=>createProvider(env,async()=>{calls++;throw Error('private network '+env.AI_API_KEY);}).complete([]),e=>e.code==='AI_CONNECTION_FAILED'&&!e.message.includes(env.AI_API_KEY));assert.equal(calls,1);
 const keepAlive=setTimeout(()=>{},1000);
 try{
  const provider=createProvider({...env,AI_TIMEOUT_MS:'10'},async(_,options)=>new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.error(Error('private stream detail')),{once:true});}})));
  await assert.rejects(()=>provider.complete([]),e=>e.code==='AI_TIMEOUT');
 }finally{clearTimeout(keepAlive);}
});

test('default timeout is exactly 20000ms and token maximum is 256 without waiting on network',async(t)=>{
 const controller=new AbortController();let duration,calls=0;
 t.mock.method(AbortSignal,'timeout',ms=>{duration=ms;queueMicrotask(()=>controller.abort());return controller.signal;});
 const config={...env};delete config.AI_MAX_OUTPUT_TOKENS;
 const provider=createProvider(config,async(_,options)=>{calls++;assert.equal(JSON.parse(options.body).max_tokens,256);return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('mock timeout')),{once:true});});});
 await assert.rejects(()=>provider.complete([]),e=>e.code==='AI_TIMEOUT');assert.equal(duration,20000);assert.equal(calls,1);
});
test('blank credentials never call fetch and an echoed secret in successful output is rejected',async()=>{
 let calls=0;assert.throws(()=>createProvider({...env,AI_API_KEY:'   '},async()=>{calls++;}),e=>e.code==='AI_DISABLED');assert.equal(calls,0);
 const provider=createProvider(env,async()=>{calls++;return Response.json({choices:[{message:{content:'echo '+env.AI_API_KEY}}]});});
 await assert.rejects(()=>provider.complete([]),e=>e.code==='AI_RESPONSE_INVALID'&&!e.message.includes(env.AI_API_KEY));assert.equal(calls,1);
});
