import { DurableObject } from 'cloudflare:workers';
import { hash, verify, validPhc } from './argon-wasm.ts';
import type { PasswordResult } from './argon-rpc.ts';

// Private RPC capability only. No account IDs, permissions, DB, cookies, network,
// alarms, timers or intentional persistence. JS/WASM memory is not guaranteed
// to be zeroized immediately after an invocation; never capture it in diagnostics.
export class PasswordHasher extends DurableObject {
  async hash(password: string): Promise<PasswordResult> {
    if (typeof password !== 'string' || password.length > 256) return { status: 'unavailable' };
    return this.#perform(() => hash(password));
  }
  async verify(encoded: string, password: string): Promise<PasswordResult> {
    if (typeof password !== 'string' || password.length > 256) return { status: 'unavailable' };
    if (typeof encoded !== 'string' || !validPhc(encoded)) return { status: 'ok', value: false };
    return this.#perform(() => verify(encoded, password));
  }
  async #perform(run: () => Promise<string | boolean>): Promise<PasswordResult> {
    try {
      return { status: 'ok', value: await run() };
    } catch (e) {
      return {
        status:
          e && typeof e === 'object' && 'statusCode' in e && e.statusCode === 429
            ? 'busy'
            : 'unavailable',
      };
    }
  }
}
export default {
  fetch() {
    return new Response('Not found', { status: 404 });
  },
};
