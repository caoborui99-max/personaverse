import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiFailure } from '../apps/api/src/errors.ts';
import { PARAMETERS, validPhc } from './argon-policy.ts';
export { Algorithm } from './argon-policy.ts';

export type PasswordResult =
  | { status: 'ok'; value: string | boolean }
  | { status: 'busy' | 'unavailable' };
export type PasswordNamespace = {
  getByName(name: string): {
    hash(password: string): Promise<PasswordResult>;
    verify(encoded: string, password: string): Promise<PasswordResult>;
  };
};
const context = new AsyncLocalStorage<PasswordNamespace | undefined>();
export function withPasswordHasher<T>(binding: PasswordNamespace | undefined, run: () => T): T {
  return context.run(binding, run);
}
function unavailable(): never {
  throw new ApiFailure(503, 'PASSWORD_SERVICE_UNAVAILABLE', '密码验证服务暂时不可用。', true);
}
async function invoke(method: 'hash' | 'verify', password: string, encoded?: string) {
  const binding = context.getStore();
  if (!binding || typeof password !== 'string' || password.length > 256) unavailable();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: PasswordResult;
  try {
    // A single private object bounds shard fan-out; no per-email object IDs or persistence.
    const stub = binding.getByName('passwords-v1');
    result = await Promise.race([
      method === 'hash' ? stub.hash(password) : stub.verify(encoded!, password),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('PASSWORD_RPC_TIMEOUT')), 5000);
      }),
    ]);
  } catch {
    // Never retry password RPC automatically or fall back to inline high-CPU computation.
    unavailable();
  } finally {
    clearTimeout(timer);
  }
  if (result?.status === 'busy') throw Object.assign(new Error('ARGON_BUSY'), { statusCode: 429 });
  if (result?.status !== 'ok') unavailable();
  return result.value;
}
export async function hash(password: string, options = PARAMETERS) {
  if (
    options.memoryCost !== PARAMETERS.memoryCost ||
    options.timeCost !== PARAMETERS.timeCost ||
    options.parallelism !== PARAMETERS.parallelism
  )
    unavailable();
  const value = await invoke('hash', password);
  if (typeof value !== 'string' || !validPhc(value)) unavailable();
  return value;
}
export async function verify(encoded: string, password: string) {
  if (typeof encoded !== 'string' || !validPhc(encoded)) return false;
  const value = await invoke('verify', password, encoded);
  if (typeof value !== 'boolean') unavailable();
  return value;
}
