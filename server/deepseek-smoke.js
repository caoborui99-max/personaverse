import {mkdir,lstat,open} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {ApiError} from './security.js';
import {createProvider,providerLimits} from './ai-provider.js';
import {getDatabase,assertDatabaseReady} from './database.js';
import {reserveChatCost} from './chat-cost.js';
export async function runDeepSeekOnce(env,{confirmed=false,fetcher=globalThis.fetch}={}) {
  if(!confirmed)throw new ApiError(403,'CONFIRMATION_REQUIRED','首次真实调用需要明确授权，本次未发送。');
  let base;try{base=new URL(env.AI_BASE_URL);}catch{throw new ApiError(503,'AI_CONFIG_INVALID','请配置官方 HTTPS 地址。');}
  if(base.origin!=='https://api.deepseek.com'||!['/','/v1','/v1/'].includes(base.pathname))throw new ApiError(503,'AI_CONFIG_INVALID','单次测试仅允许 DeepSeek 官方接口。');
  // Model ID is always supplied by the operator; never guess a default model.
  const maxOutputTokens=Math.min(providerLimits(env).maxTokens,16);
  const providerEnv={...env,AI_MAX_OUTPUT_TOKENS:String(maxOutputTokens)};
  const provider=createProvider(providerEnv,fetcher);
  const db=await getDatabase(env,{mustExist:true});
  await assertDatabaseReady(db);
  const dir=env.AI_TEST_STATE_DIR;
  if(typeof dir!=='string'||!isAbsolute(dir))throw new ApiError(503,'TEST_STATE_REQUIRED','请设置独立受保护的绝对测试状态目录。');
  await mkdir(dir,{recursive:true,mode:0o700});
  const info=await lstat(dir);
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077))throw new ApiError(503,'TEST_STATE_UNSAFE','测试状态目录必须为非符号链接私有目录（0700）。');
  let file;
  try{file=await open(join(dir,'deepseek-first-attempt.json'),'wx',0o600);}
  catch(e){if(e.code==='EEXIST')throw new ApiError(409,'AI_TEST_ALREADY_ATTEMPTED','该状态目录已经尝试过一次，不会再次调用。');throw e;}
  // Claim before network. Failed or interrupted attempts are never automatically unlocked.
  try{await file.writeFile(JSON.stringify({attemptedAt:new Date().toISOString(),status:'attempt-reserved'}));await file.sync();}finally{await file.close();}
  const messages=[{role:'user',content:'请只回复 OK。'}];
  const permit=await reserveChatCost(providerEnv,db,crypto.randomUUID(),messages,maxOutputTokens);
  await provider.complete(messages,permit);
  return {ok:true,attempts:1,maxOutputTokens};
}
