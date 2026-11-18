import { argon2id, argon2Verify } from 'hash-wasm';
import { PARAMETERS, validPhc } from './argon-policy.ts';
export { Algorithm, PARAMETERS, validPhc } from './argon-policy.ts';
// Bound parameters BEFORE handing an untrusted PHC string to a memory-hard implementation.
let active = 0;
export async function hash(password: string, options = PARAMETERS) {
  if (
    options.memoryCost !== 19456 ||
    options.timeCost !== 2 ||
    options.parallelism !== 1 ||
    password.length > 256
  )
    throw new Error('ARGON_PARAMETERS');
  if (active >= 2) throw Object.assign(new Error('ARGON_BUSY'), { statusCode: 429 });
  active++;
  try {
    return await argon2id({
      password,
      salt: crypto.getRandomValues(new Uint8Array(16)),
      parallelism: 1,
      iterations: 2,
      memorySize: 19456,
      hashLength: 32,
      outputType: 'encoded',
    });
  } finally {
    active--;
  }
}
export async function verify(encoded: string, password: string) {
  if (!validPhc(encoded) || password.length > 256) return false;
  if (active >= 2) throw Object.assign(new Error('ARGON_BUSY'), { statusCode: 429 });
  active++;
  try {
    return await argon2Verify({ password, hash: encoded });
  } catch {
    return false;
  } finally {
    active--;
  }
}
