import { ApiError } from './security.js';
export function aiConfiguration(env) {
  const enabled=env.AI_ENABLED==='true';
  const configured=[env.AI_API_KEY,env.AI_MODEL,env.AI_BASE_URL].every(value=>typeof value==='string'&&value.trim().length>0);
  return {enabled,configured,mode:enabled&&configured?'real':'demo'};
}
export function providerLimits(env) {
  function value(key,fallback,max) {
    if(env[key]===undefined||env[key]==='')return fallback;
    const n=Number(env[key]);
    if(!Number.isInteger(n)||n<1||n>max)throw new ApiError(503,'AI_CONFIG_INVALID','AI 输出或超时限制配置无效。');
    return n;
  }
  return {maxTokens:value('AI_MAX_OUTPUT_TOKENS',256,256),timeoutMs:value('AI_TIMEOUT_MS',20000,20000)};
}
export function createProvider(env, fetcher=globalThis.fetch) {
  const config=aiConfiguration(env);
  if(config.mode!=='real')throw new ApiError(503,'AI_DISABLED','真实 AI 未开启或配置不完整，当前仅可使用演示模式。');
  let base;try{base=new URL(env.AI_BASE_URL);}catch{throw new ApiError(503,'AI_CONFIG_INVALID','AI 服务地址配置无效。');}
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new ApiError(503,'AI_CONFIG_INVALID','AI 服务需要不含凭据的 HTTPS 地址。');
  if(!/^[A-Za-z0-9._:/-]{1,160}$/.test(env.AI_MODEL))throw new ApiError(503,'AI_CONFIG_INVALID','AI_MODEL 应填写供应商提供的准确模型 ID。');
  const limits=providerLimits(env);
  return {async complete(messages){
    const signal=AbortSignal.timeout(limits.timeoutMs);
    let response;
    try{response=await fetcher(base.toString().replace(/\/$/,'')+'/chat/completions',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.AI_API_KEY},body:JSON.stringify({model:env.AI_MODEL,messages,max_tokens:limits.maxTokens,stream:false}),signal});}catch{if(signal.aborted)throw new ApiError(504,'AI_TIMEOUT','AI 请求超时，未自动重试；可能已产生费用。');throw new ApiError(502,'AI_CONNECTION_FAILED','AI 请求失败或超时，未自动重试；本次测试额度保留扣减。');}
    if(!response?.ok){
      response?.body?.cancel().catch(()=>{});
      const known={401:['AI_AUTH_FAILED','供应商认证失败，请在服务端检查密钥权限。'],402:['AI_BALANCE_INSUFFICIENT','供应商余额不足，请在其控制台核实。'],404:['AI_MODEL_UNAVAILABLE','模型或接口不存在，请核对服务端模型 ID 和地址。'],429:['AI_UPSTREAM_RATE_LIMIT','供应商请求限流，请稍后人工检查。'],503:['AI_UPSTREAM_UNAVAILABLE','供应商暂时不可用。']};
      const [code,message]=known[response?.status]||['AI_UPSTREAM_FAILED','AI 服务返回错误，请检查模型、参数和供应商控制台。'];
      throw new ApiError(502,code,message+' 未自动重试。');
    }
    if(!response.body)throw new ApiError(502,'AI_RESPONSE_INVALID','AI 响应为空。');
    let bytes=0,text='';const reader=response.body.getReader();const decoder=new TextDecoder();
    try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>131072){await reader.cancel();throw Error('large');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}catch{if(signal.aborted)throw new ApiError(504,'AI_TIMEOUT','AI 响应超时，未自动重试；可能已产生费用。');throw new ApiError(502,'AI_RESPONSE_INVALID','AI 响应无效。');}finally{reader.releaseLock();}
    let data;try{data=JSON.parse(text);}catch{throw new ApiError(502,'AI_RESPONSE_INVALID','AI 响应格式无效。');}
    const content=data?.choices?.[0]?.message?.content;
    if(typeof content!=='string'||!content.trim()||content.length>12000||content.includes(env.AI_API_KEY))throw new ApiError(502,'AI_RESPONSE_INVALID','AI 未返回有效文本。');
    return content;
  }};
}
