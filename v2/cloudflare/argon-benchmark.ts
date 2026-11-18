import { hash, verify } from './argon-wasm.ts';
const password = 'TEST ONLY CPU MEASUREMENT';
let encoded = '';
// Standalone local workerd diagnostic. It has no database, credentials or outbound bindings.
export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.hostname !== '127.0.0.1' || request.method !== 'GET')
      return new Response('LOCAL_ONLY', { status: 403 });
    if (url.pathname === '/health') return Response.json({ ok: true });
    if (url.pathname === '/setup') {
      encoded = await hash(password);
      return Response.json({ ready: true });
    }
    if (url.pathname === '/hash') {
      const value = await hash(password);
      return Response.json({ valid: value.startsWith('$argon2id$v=19$m=19456,t=2,p=1$') });
    }
    if (url.pathname === '/verify' && encoded)
      return Response.json({ valid: await verify(encoded, password) });
    return new Response('NOT_FOUND', { status: 404 });
  },
};
