import { beforeAll, afterAll, it, expect } from 'vitest';
import { firefox, expect as ui, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { workersHarness } from './harness.ts';
import { passwordValid, secretHash } from '../../apps/api/src/auth.ts';

let h: Awaited<ReturnType<typeof workersHarness>>;
const contexts: BrowserContext[] = [];
const errors: string[] = [];
let owner: Page, first: Page, second: Page, outsider: Page;
let personaId: string, slug: string, chatId: string;
const account = {
  email: randomUUID() + '@test.invalid',
  password: randomBytes(24).toString('hex'),
};

async function page() {
  const context = await firefox.launchPersistentContext(h.tls!.profile(), {
    headless: true,
    baseURL: h.origin,
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: false,
  });
  contexts.push(context);
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === h.origin) await route.continue();
    else {
      errors.push('Unexpected outbound browser request');
      await route.abort();
    }
  });
  const p = context.pages()[0] ?? (await context.newPage());
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('/');
  return p;
}
async function api(p: Page, path: string, method = 'GET', body?: unknown, csrf?: string) {
  return p.evaluate(
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
function mail(email: string, purpose: string) {
  for (const name of readdirSync(h.mailDirectory)) {
    const row = JSON.parse(readFileSync(h.mailDirectory + '/' + name, 'utf8'));
    if (row.to === email && row.purpose === purpose) return row as { token: string; link: string };
  }
  throw new Error('Private simulated mail missing');
}
async function login(p: Page, user = account) {
  await p.goto('/login');
  await p.getByLabel('邮箱', { exact: true }).fill(user.email);
  await p.getByLabel('密码', { exact: true }).fill(user.password);
  await p.getByRole('button', { name: '登录', exact: true }).click();
  await ui(p).toHaveURL(h.origin + '/account');
  expect((await api(p, '/auth/session')).status).toBe(200);
}
async function secureCookie(p: Page, name: string) {
  const c = (await p.context().cookies()).find((c) => c.name === name);
  expect(c).toMatchObject({
    secure: true,
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
    domain: '127.0.0.1',
  });
  expect(await p.evaluate(() => document.cookie)).not.toContain(name);
}
beforeAll(async () => {
  h = await workersHarness({ https: true, legacyAnonymousTestMode: false });
  owner = await page();
}, 120000);
afterAll(async () => {
  for (const c of contexts) await c.close();
  await h?.close();
});

it('HTTPS certificate validation, SSR and Owner native PHC login use a trusted isolated CA', async () => {
  const html = await owner.content();
  expect(html).toContain('PersonaVerse');
  await owner.goto('/admin/login');
  await owner.getByLabel('管理员邮箱').fill(h.email);
  await owner.getByLabel('密码', { exact: true }).fill(h.password);
  await owner.getByRole('button', { name: '登录', exact: true }).click();
  await ui(owner).toHaveURL(h.origin + '/admin');
  expect((await api(owner, '/admin/auth/session')).value.admin.role).toBe('owner');
  await secureCookie(owner, '__Host-pv_v2_admin');
  await owner.reload();
  expect((await api(owner, '/admin/auth/session')).status).toBe(200);
  expect((await api(owner, '/auth/session')).status).toBe(401);
  await h.reload();
  const s = (await api(owner, '/admin/auth/session')).value;
  const write = await api(owner, '/admin/personas', 'POST', {}, s.csrfToken);
  expect(write.status, write.value.error?.code).toBe(201);
  await secureCookie(owner, '__Host-pv_v2_admin');
}, 90000);

it('a mismatched API hot-reload protocol fails closed and the pinned HTTPS protocol restores valid writes', async () => {
  await h.reload('http');
  try {
    const s = (await api(owner, '/admin/auth/session')).value;
    const rejected = await api(owner, '/admin/personas', 'POST', {}, s.csrfToken);
    expect(rejected.status, rejected.value.error?.code).toBe(403);
    expect(rejected.value.error.code).toBe('ORIGIN_REJECTED');
  } finally {
    await h.reload('https');
  }
  const s = (await api(owner, '/admin/auth/session')).value;
  const write = await api(owner, '/admin/personas', 'POST', {}, s.csrfToken);
  expect(write.status, write.value.error?.code).toBe(201);
}, 90000);

it('HTTPS Owner creates and publishes an exact-source version through the mobile editor', async () => {
  await owner.goto('/admin/personas/new');
  await owner.getByRole('button', { name: '创建空白草稿', exact: true }).click();
  await ui(owner).toHaveURL(/\/edit$/);
  personaId = new URL(owner.url()).pathname.split('/')[3]!;
  slug = 'https-test-' + randomUUID();
  const category = 'TEST ONLY HTTPS ' + randomUUID();
  await owner.getByText('新增分类', { exact: true }).click();
  await owner.getByLabel('分类名称', { exact: true }).fill(category);
  await owner.getByLabel('分类 slug', { exact: true }).fill('tls-' + randomUUID());
  await owner.getByRole('button', { name: '创建分类', exact: true }).click();
  await ui(owner.getByText('分类已创建。')).toBeVisible();
  await owner.getByLabel('人格名称', { exact: true }).fill('TEST ONLY HTTPS');
  await owner.getByLabel('页面标识 slug', { exact: true }).fill(slug);
  await owner.getByLabel('简介', { exact: true }).fill('TEST ONLY HTTPS');
  await owner.getByLabel('背景故事', { exact: true }).fill('TEST ONLY 不属于正式人格。');
  await owner.getByLabel(category, { exact: true }).check();
  await owner
    .getByLabel('完整人格内核 · 原文保存', { exact: true })
    .fill('  TEST ONLY ORIGINAL\n  ');
  await owner.getByLabel('开场白', { exact: true }).fill('TEST ONLY');
  await owner.getByRole('button', { name: '保存草稿并创建版本' }).click();
  await ui(owner.getByText('草稿已保存，并创建不可变的新版本。')).toBeVisible();
  await owner.getByRole('button', { name: '发布当前草稿', exact: true }).click();
  await ui(owner.getByText('当前草稿版本已发布。')).toBeVisible();
  const p = await h.db.persona.findUniqueOrThrow({
    where: { id: personaId },
    include: { publishedVersion: true },
  });
  expect(p.publishedVersion?.coreText).toBe('  TEST ONLY ORIGINAL\n  ');
  expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}, 90000);

it('HTTPS native registration, simulated verification, Secure login, chat, refresh and independent-device favorites work', async () => {
  first = await page();
  await first.goto('/register');
  await first.getByLabel('邮箱', { exact: true }).fill(account.email);
  await first.getByLabel('密码', { exact: true }).fill(account.password);
  await first.getByRole('button', { name: '创建账户', exact: true }).click();
  await ui(first.getByRole('status')).toContainText('本地模拟环境不会发送真实邮件');
  const m = mail(account.email, 'verify');
  expect(new URL(m.link).origin).toBe(h.origin);
  await first.goto(m.link);
  await ui(first.getByRole('button', { name: '验证邮箱', exact: true })).toBeEnabled();
  await first.getByRole('button', { name: '验证邮箱', exact: true }).click();
  await ui(first.getByRole('status')).toContainText('邮箱已通过服务端验证');
  await login(first);
  await secureCookie(first, '__Host-pv_v2_user');
  const row = await h.db.user.findUniqueOrThrow({ where: { email: account.email } });
  expect(await passwordValid(row.passwordHash, account.password)).toBe(true); // WASM -> native Node.
  await first.goto('/explore?q=HTTPS');
  await ui(first.getByRole('heading', { name: 'TEST ONLY HTTPS', exact: true })).toBeVisible();
  await first.goto('/persona/' + slug);
  await first.getByRole('button', { name: '收藏' + slug, exact: true }).click();
  await ui(first.getByRole('button', { name: '取消收藏' + slug, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await first.goto('/chat/' + slug);
  await ui(first).toHaveURL(/\/history\/[0-9a-f-]{36}$/);
  chatId = new URL(first.url()).pathname.split('/').at(-1)!;
  await ui(first.getByTestId('session-id')).toHaveText(chatId);
  await first.getByRole('textbox', { name: '消息', exact: true }).fill('TEST ONLY HTTPS PRIVATE');
  await first.getByRole('button', { name: '发送消息', exact: true }).click();
  await ui(first.locator('.message.assistant')).toHaveCount(1);
  await first.reload();
  await ui(first.locator('.message.user')).toContainText('TEST ONLY HTTPS PRIVATE');
  second = await page();
  await login(second);
  await second.goto('/history');
  await second.getByRole('link', { name: /TEST ONLY HTTPS/ }).click();
  await ui(second.getByTestId('session-id')).toHaveText(chatId);
  await ui(second.locator('.message.user')).toContainText('TEST ONLY HTTPS PRIVATE');
  await second.goto('/favorites');
  await ui(second.getByRole('heading', { name: 'TEST ONLY HTTPS', exact: true })).toBeVisible();
  const proof = '.local-preview/cloudflare-validation/evidence';
  mkdirSync(proof, { recursive: true, mode: 0o700 });
  await second.screenshot({ path: proof + '/https-mobile-favorites.png', fullPage: true });
  expect(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}, 120000);

it('HTTPS browser enforces CSRF, disabled external auth, identity isolation and session revocation after reset', async () => {
  const s = (await api(first, '/auth/session')).value;
  expect((await api(first, '/me', 'PUT', { displayName: 'DENIED' }, 'invalid')).status).toBe(403);
  expect((await api(first, '/admin/personas')).status).toBe(401);
  expect((await api(first, '/auth/rengine/capabilities')).value).toEqual({
    enabled: false,
    mode: 'disabled',
  });
  const paid = await api(first, '/me/chats/' + chatId + '/ai-requests', 'POST', {}, s.csrfToken);
  expect(paid.status, paid.value.error?.code).toBe(503);
  outsider = await page();
  expect((await api(outsider, '/me/chats/' + chatId)).status).toBe(401);
  // The attacker page is fulfilled locally. Its browser Origin and cross-site
  // navigation are real; no external DNS/network request is performed.
  await first.route('https://attacker.invalid/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<a href="${h.origin}/api/v1/auth/session">Cross-site read</a><form action="${h.origin}/api/v1/auth/logout" method="post"><button>Attack logout</button></form>`,
    }),
  );
  await first.goto('https://attacker.invalid/test');
  const [cross] = await Promise.all([
    first.waitForResponse(h.origin + '/api/v1/auth/session'),
    first.getByRole('link', { name: 'Cross-site read' }).click(),
  ]);
  expect(cross.status()).toBe(401);
  expect((await cross.request().allHeaders()).cookie ?? '').not.toContain('__Host-pv_v2_user=');
  await first.goto('https://attacker.invalid/test');
  const [attack] = await Promise.all([
    first.waitForResponse(h.origin + '/api/v1/auth/logout'),
    first.getByRole('button', { name: 'Attack logout' }).click(),
  ]);
  expect(attack.status()).toBe(403);
  expect((await attack.json()).error.code).toBe('ORIGIN_REJECTED');
  await first.goto('/login');
  expect((await api(first, '/auth/session')).status).toBe(200);
  await first.goto('/forgot-password');
  await first.getByLabel('邮箱', { exact: true }).fill(account.email);
  await first.getByRole('button', { name: '申请重置密码', exact: true }).click();
  await ui(first.getByRole('status')).toContainText('系统会安排重置通知');
  const m = mail(account.email, 'reset');
  await first.goto(m.link);
  await ui(first.getByRole('button', { name: '更新密码', exact: true })).toBeEnabled();
  account.password = randomBytes(24).toString('hex');
  await first.getByLabel('新密码', { exact: true }).fill(account.password);
  await first.getByRole('button', { name: '更新密码', exact: true }).click();
  await ui(first.getByRole('status')).toContainText('旧登录会话已撤销');
  expect((await api(second, '/auth/session')).status).toBe(401);
  await login(first);
  await first.getByRole('button', { name: '退出登录', exact: true }).click();
  await ui(first).toHaveURL(h.origin + '/login');
  expect((await api(first, '/auth/session')).status).toBe(401);
}, 120000);

it('HTTPS unpublication preserves history, blocks sends, and admin password change revokes the old session', async () => {
  const [unpublish] = await Promise.all([
    owner.waitForResponse((r) => r.url().endsWith('/unpublish') && r.request().method() === 'POST'),
    owner.getByRole('button', { name: '下架人格', exact: true }).click(),
  ]);
  expect(unpublish.status(), (await unpublish.json()).error?.code).toBe(200);
  await ui(owner.getByText('已下架，公开入口已关闭。')).toBeVisible();
  await login(second);
  await second.goto('/history/' + chatId);
  await ui(second.locator('.message.user')).toContainText('TEST ONLY HTTPS PRIVATE');
  await ui(second.getByRole('textbox', { name: '消息', exact: true })).toBeDisabled();
  const s = (await api(owner, '/admin/auth/session')).value;
  const next = randomBytes(24).toString('hex');
  const changed = await api(
    owner,
    '/admin/auth/password',
    'POST',
    { currentPassword: h.password, newPassword: next },
    s.csrfToken,
  );
  expect(changed.status).toBe(200);
  expect((await api(owner, '/admin/auth/session')).status).toBe(401);
  let releaseScripts!: () => void;
  const hydration = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await owner.route(/\/_next\/static\/.*\.js$/, async (route) => {
    if (new URL(route.request().frame().url()).pathname === '/admin') await hydration;
    await route.continue();
  });
  await owner.goto('/admin/login');
  await owner.getByLabel('管理员邮箱').fill(h.email);
  await owner.getByLabel('密码', { exact: true }).fill(next);
  await owner.getByRole('button', { name: '登录', exact: true }).click();
  await ui(owner).toHaveURL(h.origin + '/admin');
  const logoutButton = owner.getByRole('button', { name: '退出登录', exact: true });
  try {
    await ui(logoutButton).toBeDisabled(); // Delayed client JS must not swallow a logout click.
  } finally {
    releaseScripts();
  }
  const [loggedOut] = await Promise.all([
    owner.waitForResponse(
      (r) => r.url().endsWith('/admin/auth/logout') && r.request().method() === 'POST',
    ),
    logoutButton.click(),
  ]);
  expect(loggedOut.status()).toBe(200);
  await ui(owner).toHaveURL(h.origin + '/admin/login');
  expect((await api(owner, '/admin/auth/session')).status).toBe(401);
  expect(errors).toEqual([]);
}, 90000);

it('HTTPS expired server sessions redirect to native login without weakening the configured TTL', async () => {
  const c = (await second.context().cookies()).find((c) => c.name === '__Host-pv_v2_user')!;
  await h.db.userSession.update({
    where: { tokenHash: secretHash(c.value) },
    data: { lastSeenAt: new Date(Date.now() - 25 * 3600000) },
  });
  await second.goto('/account');
  await ui(second).toHaveURL(h.origin + '/login?next=%2Faccount');
  expect((await api(second, '/auth/session')).status).toBe(401);
  expect(errors).toEqual([]);
}, 90000);

it('a missing private password binding denies native and administrator authentication with 503 and recovers safely', async () => {
  await first.goto('/login');
  const usersBefore = await h.db.user.count();
  const sessionsBefore = await h.db.userSession.count();
  const adminsBefore = await h.db.adminSession.count();
  await h.passwordService(false);
  try {
    const pre = (await api(first, '/auth/csrf')).value;
    for (const [path, body] of [
      ['/auth/login', account],
      ['/auth/register', { email: randomUUID() + '@test.invalid', password: account.password }],
    ] as const) {
      const r = await api(first, path, 'POST', body, pre.csrfToken);
      expect(r.status, r.value.error?.code).toBe(503);
      expect(r.value.error.code).toBe('PASSWORD_SERVICE_UNAVAILABLE');
      expect(JSON.stringify(r.value)).not.toContain(account.password);
    }
    const adminPre = (await api(owner, '/admin/auth/csrf')).value;
    const admin = await api(
      owner,
      '/admin/auth/login',
      'POST',
      { email: h.email, password: h.password },
      adminPre.csrfToken,
    );
    expect(admin.status, admin.value.error?.code).toBe(503);
    expect((await api(first, '/auth/session')).status).toBe(401);
    expect((await api(owner, '/admin/auth/session')).status).toBe(401);
    expect(await h.db.user.count()).toBe(usersBefore);
    expect(await h.db.userSession.count()).toBe(sessionsBefore);
    expect(await h.db.adminSession.count()).toBe(adminsBefore);
  } finally {
    await h.passwordService(true);
  }
  await login(first);
  await secureCookie(first, '__Host-pv_v2_user');
}, 90000);
