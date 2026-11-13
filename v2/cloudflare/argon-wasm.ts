import { argon2id, argon2Verify } from 'hash-wasm';
export const Algorithm = { Argon2id: 2 };
export const PARAMETERS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
// Bound parameters BEFORE handing an untrusted PHC string to a memory-hard implementation.
export function validPhc(value: string) {
  return (
    /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22,86}\$[A-Za-z0-9+/]{43}$/.test(value) &&
    value.length < 256
  );
}
let active = 0;
export async function hash(password: string, options = PARAMETERS) {
  if (
    options.memoryCost !== 19456 ||
    options.timeCost !== 2 ||
    options.parallelism !== 1 ||
    password.length > 256
  )
    throw new Error('ARGON_PARAMETERS');
  if (active >= 2) throw new Error('ARGON_BUSY');
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
  if (active >= 2) throw new Error('ARGON_BUSY');
  active++;
  try {
    return await argon2Verify({ password, hash: encoded });
  } catch {
    return false;
  } finally {
    active--;
  }
}
