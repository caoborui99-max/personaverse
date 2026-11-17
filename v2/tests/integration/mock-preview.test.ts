import { it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { gateway } from '../../cloudflare/mock-preview/gateway.ts';
import {
  assertPreviewRole,
  previewOrigin,
  previewDatabase,
  previewPath,
} from '../../cloudflare/mock-preview/policy.ts';
import { signBridge, verifyBridge } from '../../packages/api-client/src/private-bridge.ts';
import { target, roleGrants } from '../../scripts/mock-preview-database.ts';
const origin = 'https://pv-web-mock-preview.test-account.workers.dev';
const secret = randomBytes(32).toString('hex');
it('requires an exact HTTPS workers.dev origin', () => {
  for (const bad of [
    'http://pv.example.workers.dev',
    'https://example.com',
    origin + '/',
    'https://x.workers.dev',
    origin + ':444',
  ])
    expect(() => previewOrigin(bad)).toThrow();
  expect(previewOrigin(origin)).toBe(origin);
});
it('requires a named isolated database and application role', () => {
  expect(() => previewDatabase('postgresql://postgres@db/main', 'main', 'postgres')).toThrow();
  expect(
    previewDatabase(
      'postgresql://pv_mock_app_test@db/pv_mock_test',
      'pv_mock_test',
      'pv_mock_app_test',
    ),
  ).toContain('pv_mock_test');
});
it.each(['/__local/probe', '/__local/runtime', '/%5f%5flocal/probe', '//__local/probe', '/%ZZ'])(
  'blocks diagnostic or malformed path %s',
  async (path) => {
    const r = new Request(origin + path);
    expect(previewPath(r)).toBe(false);
    const result = await gateway(
      r,
      {
        WEB_ORIGIN: origin,
        BRIDGE_SECRET: secret,
        API: {
          fetch: async () => {
            throw Error('must not forward');
          },
        },
      },
      async () => new Response('render'),
    );
    expect(result.status).not.toBe(200);
  },
);
it('rejects forged bridge headers and does not forward them', async () => {
  const r = new Request(origin + '/api/v1/health', { headers: { 'x-pv-ip': '203.0.113.8' } });
  expect(
    (
      await gateway(
        r,
        {
          WEB_ORIGIN: origin,
          BRIDGE_SECRET: secret,
          API: {
            fetch: async () => {
              throw Error('not reached');
            },
          },
        },
        async () => new Response(),
      )
    ).status,
  ).toBe(403);
});
it('signs trusted edge IP, discards spoofed forwarding and preserves POST Origin/Cookie/CSRF', async () => {
  const r = new Request(origin + '/api/v1/me', {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '203.0.113.4',
      'x-forwarded-for': '198.51.100.8',
      origin,
      cookie: 'test-cookie',
      'x-csrf-token': 'test-csrf',
    },
  });
  Object.defineProperty(r, 'cf', { value: {} });
  let called = false;
  const res = await gateway(
    r,
    {
      WEB_ORIGIN: origin,
      BRIDGE_SECRET: secret,
      API: {
        async fetch(input) {
          called = true;
          expect(await verifyBridge(input, secret)).toBe('203.0.113.4');
          expect(input.headers.has('x-forwarded-for')).toBe(false);
          expect(input.headers.get('origin')).toBe(origin);
          expect(input.headers.get('cookie')).toBe('test-cookie');
          expect(input.headers.get('x-csrf-token')).toBe('test-csrf');
          return new Response('ok');
        },
      },
    },
    async () => new Response(),
  );
  expect(called).toBe(true);
  expect(res.status).toBe(200);
});
it('rejects altered signatures, target URLs, IPs and stale requests', async () => {
  const r = await signBridge(new Request(origin + '/api/v1/health'), secret, '203.0.113.4');
  expect(await verifyBridge(r, secret)).toBe('203.0.113.4');
  for (const [name, value] of [
    ['x-pv-ip', '203.0.113.5'],
    ['x-pv-time', '1'],
    ['x-pv-proof', '0'.repeat(64)],
  ]) {
    const h = new Headers(r.headers);
    h.set(name!, value!);
    expect(await verifyBridge(new Request(r, { headers: h }), secret)).toBe(null);
  }
  expect(
    await verifyBridge(new Request(origin + '/api/v1/me', { headers: r.headers }), secret),
  ).toBe(null);
});
it('permits read-only SSR identity and rejects SSR mutations', async () => {
  expect(
    await verifyBridge(await signBridge(new Request(origin + '/api/v1/me'), secret, 'ssr'), secret),
  ).toBe('ssr');
  await expect(
    signBridge(new Request(origin + '/api/v1/me', { method: 'POST' }), secret, 'ssr'),
  ).rejects.toThrow();
});
it.each(['/register', '/forgot-password', '/reset-password', '/verify-email'])(
  'closes email page %s',
  async (path) => {
    expect(
      (
        await gateway(
          new Request(origin + path),
          { WEB_ORIGIN: origin, BRIDGE_SECRET: secret, API: { fetch: async () => new Response() } },
          async () => new Response('form'),
        )
      ).status,
    ).toBe(503);
  },
);
it('remote migration guard rejects implicit, production, pooler and mismatched targets', () => {
  expect(() => target({})).toThrow();
  const env = {
    APP_ENV: 'mock-preview',
    PREVIEW_MIGRATION_URL:
      'postgresql://pv_mock_migrator_test@dedicated.invalid/pv_mock_test?sslmode=verify-full',
    PREVIEW_CONFIRMED_HOST: 'dedicated.invalid',
    PREVIEW_CONFIRMED_DATABASE: 'pv_mock_test',
  };
  expect(target(env).pathname).toBe('/pv_mock_test');
  for (const change of [
    { APP_ENV: 'production' },
    { PREVIEW_CONFIRMED_HOST: 'other.invalid' },
    { PREVIEW_MIGRATION_URL: env.PREVIEW_MIGRATION_URL.replace('dedicated', 'pooler') },
    { PREVIEW_MIGRATION_URL: env.PREVIEW_MIGRATION_URL.replace('verify-full', 'require') },
  ])
    expect(() => target({ ...env, ...change })).toThrow();
  expect(() => roleGrants('public', 'postgres')).toThrow();
});

it('runtime role preflight rejects owners, elevated grants, wrong accounts and databases', async () => {
  for (const rows of [
    [],
    [{ role: 'pv_mock_app_test', database: 'pv_mock_test', privileged: true }],
    [{ role: 'postgres', database: 'pv_mock_test', privileged: false }],
    [{ role: 'pv_mock_app_test', database: 'production', privileged: false }],
  ])
    await expect(
      assertPreviewRole(async () => rows, 'pv_mock_app_test', 'pv_mock_test'),
    ).rejects.toThrow();
  await expect(
    assertPreviewRole(
      async () => [{ role: 'pv_mock_app_test', database: 'pv_mock_test', privileged: false }],
      'pv_mock_app_test',
      'pv_mock_test',
    ),
  ).resolves.toBeUndefined();
});
