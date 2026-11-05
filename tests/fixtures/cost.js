// Synthetic prices/budgets for local tests only; never inherited from process.env.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createProvider as realProvider,providerLimits} from '../../server/ai-provider.js';
import {getDatabase,migrateDatabase,closeDatabases} from '../../server/database.js';
import {initializeData} from '../../server/handler.js';
import {reserveChatCost} from '../../server/chat-cost.js';
export function costEnv(env) {
  return {AI_COST_DAILY_BUDGET_CNY:'100',AI_COST_MONTHLY_BUDGET_CNY:'1000',
    AI_PRICE_INPUT_CNY_PER_MILLION:'1',AI_PRICE_OUTPUT_CNY_PER_MILLION:'2',
    AI_PRICE_TOKEN_BOUND:'utf8-byte-upper-bound',...env,
    AI_PRICE_MODEL:env.AI_PRICE_MODEL??env.AI_MODEL,AI_PRICE_BASE_URL:env.AI_PRICE_BASE_URL??env.AI_BASE_URL};
}
// Legacy Provider serialization/error tests still exercise real persisted permits.
export function createProvider(env,fetcher) {
  const config=costEnv(env), provider=realProvider(config,fetcher);
  return {async complete(messages,permit){
    if(permit)return provider.complete(messages,permit);
    const dir=await mkdtemp(join(tmpdir(),'pv-provider-budget-'));
    try{
      const db=await getDatabase({SQLITE_PATH:join(dir,'fixture.sqlite')});await migrateDatabase(db);
      const reserved=await reserveChatCost(config,db,randomUUID(),messages,providerLimits(config).maxTokens);
      return await provider.complete(messages,reserved);
    }finally{await closeDatabases();await rm(dir,{recursive:true,force:true});}
  }};
}
export async function smokeConfig(env,dir) {
  const config=costEnv({...env,AI_TEST_STATE_DIR:dir,SQLITE_PATH:join(dir,'fixture.sqlite')});
  const db=await getDatabase(config);await migrateDatabase(db);await initializeData(db);
  return config;
}
