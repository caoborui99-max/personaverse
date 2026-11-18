import { it, expect, vi } from 'vitest';
import { mockRengineProvider, rengineProvider } from '../../apps/api/src/auth-providers/rengine.ts';
import { createFetchApp } from '../../apps/api/src/fetch-app.ts';
const response = (data: unknown) => Response.json({ success: true, data });
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const transport = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const data: Record<string, unknown> = {
      '/get-safe-login-token': {
        safe_login_key: 'synthetic-safe-key',
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
      '/exchange': { token: 'synthetic-user-token' },
      '/verify-access-token': {
        user_id: 7,
        software_id: 1,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
      '/get-user-by-token': { id: 7, uuid: 'synthetic-user-uuid', email: 'ignored@test.invalid' },
    };
    return response(path in overrides ? overrides[path] : data[path]);
  });
  return {
    calls,
    transport,
    provider: rengineProvider({
      softwareToken: 'synthetic-software-fixture',
      softwareId: '1',
      callback: 'https://example.invalid/auth/rengine/callback',
      transport: transport as typeof fetch,
    }),
  };
}
it('uses fixed POST endpoints, safe key and TE; verifies matching user and software without exposing tokens', async () => {
  const h = fixture();
  const url = await h.provider.start('synthetic-state');
  expect(url).not.toContain('synthetic-software-fixture');
  expect(new URL(url).searchParams.get('state')).toBe('synthetic-state');
  expect(h.calls[0]!.body).toMatchObject({
    env: 'web',
    te: true,
    port: 'https://example.invalid/auth/rengine/callback',
  });
  expect(await h.provider.verify('code')).toMatchObject({
    subject: '7',
    softwareId: '1',
    uuid: 'synthetic-user-uuid',
  });
  expect(h.calls.map((c) => new URL(c.url).hostname)).toEqual(Array(4).fill('api.rengine.top'));
});
it('rejects wrong software, mismatched subject, unsafe IDs and expired tokens', async () => {
  for (const data of [
    { user_id: 7, software_id: 2, expires_at: new Date(Date.now() + 60000).toISOString() },
    { user_id: 8, software_id: 1, expires_at: new Date(Date.now() + 60000).toISOString() },
    {
      user_id: Number.MAX_SAFE_INTEGER + 1,
      software_id: 1,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    },
    { user_id: 7, software_id: 1, expires_at: new Date(0).toISOString() },
  ])
    await expect(
      fixture({ '/verify-access-token': data }).provider.verify('code'),
    ).rejects.toThrow();
});
it('fails closed on HTML429, malformed JSON, oversized response and network errors without leaking upstream content', async () => {
  for (const result of [
    new Response('<html>private</html>', { status: 429 }),
    new Response('not-json', { headers: { 'content-type': 'application/json' } }),
    new Response('x'.repeat(40000), { headers: { 'content-type': 'application/json' } }),
  ]) {
    const provider = rengineProvider({
      softwareToken: 'synthetic-fixture',
      softwareId: '1',
      callback: 'https://example.invalid/callback',
      transport: vi.fn(async () => result) as typeof fetch,
    });
    await expect(provider.verify('code')).rejects.toThrow('EXTERNAL_PROVIDER_UNAVAILABLE');
  }
});
it('Workers thin transport preserves separate Set-Cookie headers', async () => {
  const app = createFetchApp();
  app.setErrorHandler((_, __, reply) => reply.code(500).send({}));
  app.setNotFoundHandler((_, reply) => reply.code(404).send({}));
  app.get('/cookies', (_, reply) => {
    reply.header('Set-Cookie', 'a=one; HttpOnly; SameSite=Strict');
    reply.header('Set-Cookie', 'b=two; HttpOnly; SameSite=Strict');
    return { ok: true };
  });
  await app.ready();
  const r = await app.fetch(new Request('https://example.invalid/cookies'));
  expect(r.headers.getSetCookie()).toEqual([
    'a=one; HttpOnly; SameSite=Strict',
    'b=two; HttpOnly; SameSite=Strict',
  ]);
});

it('Mock provider never calls fetch and provider network failures are sanitized', async () => {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('PRIVATE_NETWORK_DETAIL'));
  try {
    const mock = mockRengineProvider();
    await mock.start('state');
    await mock.verify('mock-test');
    expect(network).not.toHaveBeenCalled();
    const provider = rengineProvider({
      softwareToken: 'synthetic-fixture',
      softwareId: '1',
      callback: 'https://example.invalid/callback',
      transport: network as typeof fetch,
    });
    await expect(provider.verify('code')).rejects.toThrow('EXTERNAL_PROVIDER_UNAVAILABLE');
  } finally {
    network.mockRestore();
  }
});
