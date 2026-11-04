import {runDeepSeekOnce} from '../server/deepseek-smoke.js';
try {
  if(process.argv.length!==3||process.argv[2]!=='--confirm-one-request')throw Error('CONFIRMATION_REQUIRED');
  await runDeepSeekOnce(process.env,{confirmed:true});
  console.log('DeepSeek single request completed. Verify actual usage and charge in your provider console; no response content is logged.');
} catch(error) {
  // Never print error objects, upstream bodies, environment or credential values.
  const safe=['CONFIRMATION_REQUIRED','AI_DISABLED','AI_CONFIG_INVALID','TEST_STATE_REQUIRED','TEST_STATE_UNSAFE','AI_TEST_ALREADY_ATTEMPTED','AI_AUTH_FAILED','AI_BALANCE_INSUFFICIENT','AI_MODEL_UNAVAILABLE','AI_UPSTREAM_RATE_LIMIT','AI_UPSTREAM_UNAVAILABLE','AI_UPSTREAM_FAILED','AI_TIMEOUT','AI_CONNECTION_FAILED','AI_RESPONSE_INVALID'];
  console.error('Single test stopped: '+(safe.includes(error.code||error.message)?(error.code||error.message):'TEST_FAILED')+'. No automatic retry.');
  process.exitCode=1;
}
