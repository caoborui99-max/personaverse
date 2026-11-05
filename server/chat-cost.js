import {ApiError,sha256} from './security.js';

const permits = new WeakMap();
const MAX_MICRO = 1_000_000_000_000;
const failConfig = () => new ApiError(503,'AI_COST_CONFIG_INVALID','AI 费用预算或模型价格未完整配置，已禁止请求。');
function money(value) {
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value))throw failConfig();
  const [whole,fraction='']=value.split('.');
  const n=BigInt(whole)*1_000_000n+BigInt(fraction.padEnd(6,'0'));
  if(n<=0n||n>BigInt(MAX_MICRO))throw failConfig();
  return Number(n);
}
function endpoint(value) {
  let u;try{u=new URL(value);}catch{throw failConfig();}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw failConfig();
  return u.toString().replace(/\/$/,'');
}
export function costConfiguration(env) {
  if(typeof env.AI_MODEL!=='string'||!env.AI_MODEL||env.AI_PRICE_MODEL!==env.AI_MODEL)throw failConfig();
  const base=endpoint(env.AI_BASE_URL);
  if(typeof env.AI_API_KEY==='string'&&env.AI_API_KEY){
    let decoded;try{decoded=decodeURIComponent(base);}catch{throw failConfig();}
    if(decoded.includes(env.AI_API_KEY)||env.AI_MODEL.includes(env.AI_API_KEY))throw failConfig();
  }
  if(endpoint(env.AI_PRICE_BASE_URL)!==base)throw failConfig();
  // This is an explicit operator attestation for the conservative estimate, not a tokenizer claim.
  if(env.AI_PRICE_TOKEN_BOUND!=='utf8-byte-upper-bound')throw failConfig();
  return {base,model:env.AI_MODEL,
    daily:money(env.AI_COST_DAILY_BUDGET_CNY),monthly:money(env.AI_COST_MONTHLY_BUDGET_CNY),
    input:money(env.AI_PRICE_INPUT_CNY_PER_MILLION),output:money(env.AI_PRICE_OUTPUT_CNY_PER_MILLION)};
}
export function costReady(env) {try{costConfiguration(env);return true;}catch{return false;}}
function configurationKey(env,maxTokens) {return JSON.stringify([costConfiguration(env),maxTokens]);}
export function estimateCost(env,messages,maxTokens) {
  const config=costConfiguration(env);
  if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>256||!Array.isArray(messages)||messages.length>8||messages.some(m=>!['system','user','assistant'].includes(m?.role)||typeof m.content!=='string'))throw failConfig();
  const bytes=Buffer.byteLength(JSON.stringify(messages),'utf8');
  if(bytes>196608)throw new ApiError(400,'AI_CONTEXT_TOO_LARGE','对话上下文过长，未发送请求。');
  // Intentionally over-reserve: UTF-8 bytes plus explicit framing overhead; never release on success.
  // Operators must validate this bound and worst-case prices for the exact endpoint/model.
  const inputBound=bytes+256*messages.length+1024;
  const amount=(BigInt(inputBound)*BigInt(config.input)+BigInt(maxTokens)*BigInt(config.output)+999999n)/1000000n;
  if(amount<1n||amount>BigInt(MAX_MICRO))throw failConfig();
  return {config,amount:Number(amount),inputBound};
}

export async function reserveChatCost(env,db,requestId,messages,maxTokens,now=new Date()) {
  const {config,amount,inputBound}=estimateCost(env,messages,maxTokens);
  if(amount>config.daily||amount>config.monthly)throw new ApiError(429,'AI_COST_BUDGET_EXCEEDED','全站 AI 费用预算不足，未发送请求。');
  const day=now.toISOString().slice(0,10),month=now.toISOString().slice(0,7);
  const statements=[];
  for(const [kind,start,limit] of [['day',day,config.daily],['month',month,config.monthly]]){
    statements.push(db.prepare('INSERT INTO ai_cost_periods(kind,period_start,reserved_micro_cny,last_request_id) VALUES (?,?,0,?) ON CONFLICT(kind,period_start) DO NOTHING').bind(kind,start,''));
    statements.push(db.prepare('UPDATE ai_cost_periods SET reserved_micro_cny=reserved_micro_cny+?,last_request_id=? WHERE kind=? AND period_start=? AND reserved_micro_cny<=?').bind(amount,requestId,kind,start,limit-amount));
  }
  // The NOT NULL constraint is the transaction assertion. Either both guarded updates belong
  // to this request, or the entire SQLite/Neon batch rolls back. No read-then-debit race.
  statements.push(db.prepare(`INSERT INTO ai_cost_reservations(request_id,reserved_micro_cny,model,base_url,input_bound,max_output_tokens,price_input_micro,price_output_micro,created_at)
    SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM ai_cost_periods WHERE kind='day' AND period_start=? AND last_request_id=?)
    AND EXISTS(SELECT 1 FROM ai_cost_periods WHERE kind='month' AND period_start=? AND last_request_id=?) THEN CAST(? AS BIGINT) ELSE NULL END,?,?,?,?,?,?,?`)
    .bind(requestId,day,requestId,month,requestId,amount,config.model,config.base,inputBound,maxTokens,config.input,config.output,now.toISOString()));
  try{await db.batch(statements);}catch(error){
    const assertion=error?.code==='23502'||String(error?.message).includes('NOT NULL constraint failed: ai_cost_reservations.reserved_micro_cny');
    if(assertion)throw new ApiError(429,'AI_COST_BUDGET_EXCEEDED','全站 AI 费用预算不足，未发送请求。');
    throw new ApiError(503,'AI_COST_GUARD_UNAVAILABLE','费用保护暂不可用，已禁止请求。');
  }
  const permit={};
  permits.set(permit,{key:configurationKey(env,maxTokens),hash:await sha256(JSON.stringify(messages))});
  return permit;
}

// Every real Provider entry point needs a single-use, message/config-bound reservation.
export async function consumeCostPermit(env,messages,maxTokens,permit) {
  const reservation=permit&&permits.get(permit);
  if(!reservation)throw new ApiError(503,'AI_COST_RESERVATION_REQUIRED','缺少有效费用预留，已禁止请求。');
  permits.delete(permit);
  if(reservation.key!==configurationKey(env,maxTokens)||reservation.hash!==await sha256(JSON.stringify(messages)))throw new ApiError(503,'AI_COST_RESERVATION_REQUIRED','费用预留与请求不匹配，已禁止请求。');
}
