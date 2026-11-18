import { beforeAll, afterAll, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { harness } from './harness.ts';
import { buildDatabaseApp } from '../../apps/api/src/database-app.ts';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
}, 30000);
afterAll(async () => {
  await h?.close();
});
const cookieValue = (value: string | string[] | number | undefined) => String(value).split(';')[0]!;

it('uses Strict host-only cookies and verifies the actual cookie session after login and refresh', async () => {
  const pre = await h.app.inject('/api/v1/admin/auth/csrf');
  const preCookie = String(pre.headers['set-cookie']);
  expect(preCookie).toMatch(/^pv_v2_login_local=/);
  expect(preCookie).toContain('; HttpOnly; SameSite=Strict; Path=/;');
  expect(preCookie).not.toContain('Domain=');
  expect(preCookie).not.toContain('; Secure');

  const { res, headers, session } = await h.login();
  expect(res.statusCode).toBe(200);
  const adminCookie = String(res.headers['set-cookie']);
  expect(adminCookie).toMatch(/^pv_v2_admin_local=/);
  expect(adminCookie).toContain('; HttpOnly; SameSite=Strict; Path=/;');
  expect(adminCookie).not.toContain('Domain=');
  expect(adminCookie).not.toContain('; Secure');
  expect(session?.statusCode).toBe(200);
  expect((await h.app.inject({ url: '/api/v1/admin/auth/session', headers })).json()).toMatchObject(
    {
      admin: { id: h.admin.id },
      csrfToken: headers['x-csrf-token'],
    },
  );
  // A successful login response alone does not authorize a client which lost/rejected its Cookie.
  expect((await h.app.inject('/api/v1/admin/auth/session')).statusCode).toBe(401);
});

it('rejects a hostile Origin and cross-site fetch metadata even with a valid session and CSRF token', async () => {
  const { headers } = await h.login();
  for (const attackHeaders of [
    { ...headers, origin: 'https://evil.invalid' },
    { ...headers, 'sec-fetch-site': 'cross-site' },
  ]) {
    const rejected = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/logout',
      headers: attackHeaders,
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe('ORIGIN_REJECTED');
  }
  // Neither rejected cross-site request may revoke the victim's session.
  expect((await h.app.inject({ url: '/api/v1/admin/auth/session', headers })).statusCode).toBe(200);
});

it('binds pre-login and authenticated CSRF tokens to their corresponding opaque cookies', async () => {
  const first = await h.app.inject('/api/v1/admin/auth/csrf');
  const second = await h.app.inject('/api/v1/admin/auth/csrf');
  const login = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/auth/login',
    headers: {
      origin: h.origin,
      cookie: cookieValue(first.headers['set-cookie']),
      'x-csrf-token': second.json().csrfToken,
    },
    payload: { email: h.email, password: h.password },
  });
  expect(login.statusCode).toBe(403);
  expect(login.headers['set-cookie']).toBeUndefined();

  const one = await h.login();
  const two = await h.login();
  const mismatch = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/auth/logout',
    headers: { ...one.headers, 'x-csrf-token': two.headers['x-csrf-token'] },
  });
  expect(mismatch.statusCode).toBe(403);
  expect(mismatch.json().error.code).toBe('CSRF_REJECTED');
  expect(
    (await h.app.inject({ url: '/api/v1/admin/auth/session', headers: one.headers })).statusCode,
  ).toBe(200);
  expect(
    (await h.app.inject({ method: 'POST', url: '/api/v1/admin/auth/logout', headers: one.headers }))
      .statusCode,
  ).toBe(200);
  expect(
    (await h.app.inject({ url: '/api/v1/admin/auth/session', headers: one.headers })).statusCode,
  ).toBe(401);
});

it('keeps HTTPS Secure __Host cookies and local HTTP cookies in separate namespaces', async () => {
  const [current] = await h.db.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('schema', current!.schema);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const app = buildDatabaseApp({
    db,
    config: {
      environment: 'test',
      databaseUrl: url.toString(),
      origin: 'https://test.invalid',
      secure: true,
    },
  });
  try {
    const pre = await app.inject('/api/v1/admin/auth/csrf');
    const preCookie = String(pre.headers['set-cookie']);
    expect(preCookie).toMatch(/^__Host-pv_v2_login=/);
    expect(preCookie).toContain('; HttpOnly; SameSite=Strict; Path=/;');
    expect(preCookie).toContain('; Secure');
    expect(preCookie).not.toContain('Domain=');
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      headers: {
        origin: 'https://test.invalid',
        cookie: cookieValue(pre.headers['set-cookie']),
        'x-csrf-token': pre.json().csrfToken,
      },
      payload: { email: h.email, password: h.password },
    });
    expect(login.statusCode).toBe(200);
    const secureCookie = String(login.headers['set-cookie']);
    expect(secureCookie).toMatch(/^__Host-pv_v2_admin=/);
    expect(secureCookie).toContain('; HttpOnly; SameSite=Strict; Path=/;');
    expect(secureCookie).toContain('; Secure');
    expect(secureCookie).not.toContain('Domain=');
    expect(
      (
        await app.inject({
          url: '/api/v1/admin/auth/session',
          headers: { cookie: cookieValue(secureCookie) },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await h.app.inject({
          url: '/api/v1/admin/auth/session',
          headers: { cookie: cookieValue(secureCookie) },
        })
      ).statusCode,
    ).toBe(401);
    const local = await h.login();
    expect(
      (
        await app.inject({
          url: '/api/v1/admin/auth/session',
          headers: { cookie: local.headers.cookie },
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});
