import { z } from 'zod';
export type ExternalAssertion = {
  subject: string;
  uuid: string;
  softwareId: string;
  expiresAt: Date;
};
export interface RengineProvider {
  softwareId: string;
  start(state: string): Promise<string>;
  verify(code: string): Promise<ExternalAssertion>;
}
const id = z.number().int().positive().safe().transform(String);
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
// No default transport: production must explicitly authorize and inject server-side fetch.
export function rengineProvider(options: {
  softwareToken: string;
  softwareId: string;
  callback: string;
  transport: typeof fetch;
}): RengineProvider {
  const callback = new URL(options.callback);
  if (
    callback.protocol !== 'https:' ||
    callback.username ||
    callback.password ||
    callback.hash ||
    callback.search ||
    options.callback.length > 200
  )
    throw new Error('Invalid fixed callback');
  async function post(path: string, body: unknown) {
    try {
      const response = await options.transport('https://api.rengine.top' + path, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (
        !response.ok ||
        !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
      )
        throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      let text = '',
        size = 0;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          size += r.value.length;
          if (size > 32768) {
            await reader.cancel();
            throw new Error();
          }
          text += decoder.decode(r.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('EXTERNAL_PROVIDER_UNAVAILABLE');
    }
  }
  return {
    softwareId: options.softwareId,
    async start(state) {
      const r = envelope(
        z.object({
          safe_login_key: z.string().min(1).max(2048),
          expires_at: z.string().datetime(),
        }),
      ).parse(
        await post('/get-safe-login-token', {
          token: options.softwareToken,
          port: options.callback,
          env: 'web',
          te: true,
        }),
      );
      if (Date.parse(r.data.expires_at) <= Date.now())
        throw new Error('EXTERNAL_PROVIDER_UNAVAILABLE');
      const url = new URL('https://authlogin.rengine.top/');
      url.searchParams.set('safeloginkey', r.data.safe_login_key);
      url.searchParams.set('state', state);
      return url.toString();
    },
    async verify(code) {
      const exchanged = envelope(z.object({ token: z.string().min(1).max(4096) })).parse(
        await post('/exchange', { code }),
      );
      const token = exchanged.data.token;
      const verified = envelope(
        z.object({ user_id: id, software_id: id, expires_at: z.string().datetime() }),
      ).parse(await post('/verify-access-token', { token }));
      const profile = envelope(z.object({ id, uuid: z.string().min(1).max(128) })).parse(
        await post('/get-user-by-token', { token }),
      );
      if (
        verified.data.software_id !== options.softwareId ||
        verified.data.user_id !== profile.data.id ||
        Date.parse(verified.data.expires_at) <= Date.now()
      )
        throw new Error('EXTERNAL_IDENTITY_REJECTED');
      return {
        subject: profile.data.id,
        uuid: profile.data.uuid,
        softwareId: verified.data.software_id,
        expiresAt: new Date(verified.data.expires_at),
      };
    },
  };
}
export function mockRengineProvider(): RengineProvider {
  return {
    softwareId: '1',
    async start(state) {
      return '/auth/rengine/callback?type=code&v=mock-subject&state=' + encodeURIComponent(state);
    },
    async verify(code) {
      if (!/^mock-[a-z0-9-]{1,80}$/.test(code)) throw new Error('EXTERNAL_IDENTITY_REJECTED');
      return {
        subject: code,
        uuid: 'uuid-' + code,
        softwareId: '1',
        expiresAt: new Date(Date.now() + 60000),
      };
    },
  };
}
