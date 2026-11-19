import { it, expect } from 'vitest';
import { privateApiRequest } from '../../packages/api-client/src/service-request.ts';
import { signBridge, verifyBridge } from '../../packages/api-client/src/private-bridge.ts';
import { gateway } from '../../cloudflare/production/gateway.ts';
import {
  productionOrigin,
  productionDatabase,
  assertProductionRole,
} from '../../cloudflare/production/policy.ts';
const origin = 'https://pv-web-production.test-account.workers.dev';
const secret = 'synthetic-bridge-secret-32-bytes-minimum';
it.each(['http://127.0.0.1:4311', 'http://localhost:4311', 'https://old.example:4311'])(
  'SSR rebuilds %s on the exact public origin before HMAC signing',
  async (source) => {
    const request = await privateApiRequest(
      source + '/api/v1/personas?q=%E4%BA%BA&page=2',
      { headers: { cookie: 'synthetic=only' } },
      origin,
      secret,
    );
    expect(request.url).toBe(origin + '/api/v1/personas?q=%E4%BA%BA&page=2');
    expect(new URL(request.url).port).toBe('');
    expect(request.headers.get('cookie')).toBe('synthetic=only');
    expect(await verifyBridge(request, secret)).toBe('ssr');
    expect(await verifyBridge(request, secret + 'wrong')).toBeNull();
    expect(await verifyBridge(new Request(request.url + '&changed=1', request), secret)).toBeNull();
  },
);
it('retains exact-origin policy and does not turn SSR into a write capability', async () => {
  await expect(
    privateApiRequest('http://localhost:4311/api/v1/personas', {}, origin + ':4311', secret),
  ).rejects.toThrow();
  await expect(
    privateApiRequest('http://localhost:4311/api/v1/personas', { method: 'POST' }, origin, secret),
  ).rejects.toThrow('INVALID_CLIENT_IP');
  await expect(
    privateApiRequest('http://localhost:4311//outside.example/api/v1/personas', {}, origin, secret),
  ).rejects.toThrow();
});
it('gateway catches a rejected Service Binding rather than escaping as an unhandled 500', async () => {
  const request = new Request(origin + '/api/v1/personas', {
    headers: { 'cf-connecting-ip': '203.0.113.9' },
  });
  Object.defineProperty(request, 'cf', { value: {} });
  const response = await gateway(
    request,
    {
      WEB_ORIGIN: origin,
      BRIDGE_SECRET: secret,
      API: {
        async fetch(forwarded) {
          expect(await verifyBridge(forwarded, secret)).toBe('203.0.113.9');
          throw Error('synthetic binding failure');
        },
      },
    },
    async () => new Response('unused'),
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('synthetic binding failure');
});
it('rejects foreign origin and forged proof, and preserves the signed URL on success', async () => {
  const env = {
    WEB_ORIGIN: origin,
    BRIDGE_SECRET: secret,
    API: {
      async fetch(r: Request) {
        expect(r.url).toBe(origin + '/api/v1/personas');
        expect(await verifyBridge(r, secret)).toBe('203.0.113.9');
        return Response.json({ ok: true });
      },
    },
  };
  expect(
    (
      await gateway(
        new Request('https://other.example/api/v1/personas'),
        env,
        async () => new Response('bad'),
      )
    ).status,
  ).toBe(421);
  expect(
    (
      await gateway(
        new Request(origin + '/api/v1/personas', { headers: { 'x-pv-ip': 'forged' } }),
        env,
        async () => new Response('bad'),
      )
    ).status,
  ).toBe(403);
  const r = new Request(origin + '/api/v1/personas', {
    headers: { 'cf-connecting-ip': '203.0.113.9' },
  });
  Object.defineProperty(r, 'cf', { value: {} });
  expect((await gateway(r, env, async () => new Response('bad'))).status).toBe(200);
});
it('does not normalize away unsafe production origins or wrong database identities', async () => {
  expect(() => productionOrigin(origin + ':4311')).toThrow();
  expect(() =>
    productionDatabase(
      'postgresql://wrong:synthetic@localhost/neondb',
      'neondb',
      'personaverse_app',
    ),
  ).toThrow();
  await expect(
    assertProductionRole(
      async () => [{ role: 'personaverse_app', database: 'neondb', privileged: true }],
      'personaverse_app',
      'neondb',
    ),
  ).rejects.toThrow('LEAST_PRIVILEGE_ROLE_REQUIRED');
  await expect(
    assertProductionRole(
      async () => [{ role: 'personaverse_app', database: 'neondb', privileged: false }],
      'personaverse_app',
      'neondb',
    ),
  ).resolves.toBeUndefined();
});
