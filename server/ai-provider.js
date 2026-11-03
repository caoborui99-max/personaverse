import { ApiError } from './security.js';
export function aiConfiguration(env) {
  const enabled=env.AI_ENABLED==='true';
  const configured=!!(env.AI_API_KEY && env.AI_MODEL && env.AI_BASE_URL);
  return {enabled,configured,mode:enabled&&configured?'real':'demo'};
}
export function createProvider(env, fetcher=globalThis.fetch) {
  const config=aiConfiguration(env);
  if(config.mode!=='real')throw new ApiError(503,'AI_DISABLED','真实 AI 未开启或配置不完整，当前仅可使用演示模式。');
  let base;try{base=new URL(env.AI_BASE_URL);}catch{throw new ApiError(503,'AI_CONFIG_INVALID','AI 服务地址配置无效。');}
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new ApiError(503,'AI_CONFIG_INVALID','AI 服务需要不含凭据的 HTTPS 地址。');
  if(!/^[A-Za-z0-9._:/-]{1,160}$/.test(env.AI_MODEL))throw new ApiError(503,'AI_CONFIG_INVALID','AI_MODEL 应填写供应商提供的准确模型 ID。');
  return {async complete(messages){
    let response;
    try{response=await fetcher(base.toString().replace(/\/$/,'')+'/chat/completions',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.AI_API_KEY},body:JSON.stringify({model:env.AI_MODEL,messages,max_tokens:256,stream:false}),signal:AbortSignal.timeout(20000)});}catch{throw new ApiError(502,'AI_CONNECTION_FAILED','AI 请求失败或超时，未自动重试；本次测试额度保留扣减。');}
    if(!response.ok)throw new ApiError(502,'AI_UPSTREAM_FAILED','AI 服务返回错误，请检查供应商控制台；未自动重试。');
    let bytes=0,text='';const reader=response.body.getReader();const decoder=new TextDecoder();
    try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>131072){await reader.cancel();throw Error('large');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}catch{throw new ApiError(502,'AI_RESPONSE_INVALID','AI 响应无效。');}finally{reader.releaseLock();}
    let data;try{data=JSON.parse(text);}catch{throw new ApiError(502,'AI_RESPONSE_INVALID','AI 响应格式无效。');}
    const content=data?.choices?.[0]?.message?.content;
    if(typeof content!=='string'||!content.trim()||content.length>12000)throw new ApiError(502,'AI_RESPONSE_INVALID','AI 未返回有效文本。');
    return content;
  }};
}
