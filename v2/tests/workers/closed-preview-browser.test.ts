import { beforeAll, afterAll, it, expect } from 'vitest';
import { firefox, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { workersHarness } from './harness.ts';
import { passwordHash } from '../../apps/api/src/auth.ts';
let h: Awaited<ReturnType<typeof workersHarness>>, context: BrowserContext, page: Page;
beforeAll(async () => {
  h = await workersHarness({
    https: true,
    closedMockPreview: true,
    legacyAnonymousTestMode: false,
  });
  context = await firefox.launchPersistentContext(h.tls!.profile(), {
    headless: true,
    baseURL: h.origin,
    ignoreHTTPSErrors: false,
    viewport: { width: 390, height: 844 },
  });
  page = context.pages()[0] ?? (await context.newPage());
  await page.goto('/');
}, 120000);
afterAll(async () => {
  await context?.close();
  await h?.close();
});
async function api(path: string, method = 'GET', body?: unknown, csrf?: string) {
  return page.evaluate(
    async ({ path, method, body, csrf }) => {
      const r = await fetch('/api/v1' + path, {
        method,
        headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, value: await r.json() };
    },
    { path, method, body, csrf },
  );
}
it('closed mode in real HTTPS Firefox/workerd keeps native login, user/admin isolation and revocation; closes mail and third-party entry', async () => {
  const user = { email: randomUUID() + '@test.invalid', password: randomBytes(24).toString('hex') };
  await h.db.user.create({
    data: {
      email: user.email,
      passwordHash: await passwordHash(user.password),
      emailVerifiedAt: new Date(),
    },
  });
  for (const path of ['/auth/register', '/auth/forgot-password', '/auth/reset-password'])
    expect((await api(path, 'POST', {}, 'invalid')).status).toBe(503);
  expect((await api('/auth/rengine/capabilities')).value.enabled).toBe(false);
  const pre = await api('/auth/csrf');
  expect((await api('/auth/login', 'POST', user, pre.value.csrfToken)).status).toBe(200);
  const session = await api('/auth/session');
  expect(session.status).toBe(200);
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === '__Host-pv_v2_user');
  expect(cookie).toBeDefined();
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  expect((await api('/admin/auth/session')).status).toBe(401);
  expect((await api('/auth/logout', 'POST', {})).status).toBe(403);
  expect((await api('/auth/logout', 'POST', {}, session.value.csrfToken)).status).toBe(200);
  expect((await api('/auth/session')).status).toBe(401);
  const adminPre = await api('/admin/auth/csrf');
  expect(
    (
      await api(
        '/admin/auth/login',
        'POST',
        { email: h.email, password: h.password },
        adminPre.value.csrfToken,
      )
    ).status,
  ).toBe(200);
  const admin = await api('/admin/auth/session');
  expect(admin.value.admin.role).toBe('owner');
  expect((await api('/auth/session')).status).toBe(401);
  expect((await api('/admin/auth/logout', 'POST', {}, admin.value.csrfToken)).status).toBe(200);
  expect((await api('/admin/auth/session')).status).toBe(401);
}, 45000);
