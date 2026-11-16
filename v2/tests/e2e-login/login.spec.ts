import { test, expect, type Page, type BrowserContext, type Cookie } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { secretHash } from '../../apps/api/src/auth.ts';
const origin = 'http://127.0.0.1:4310';
const proof = resolve('.local-preview/login-evidence');
type Account = { email: string; password: string; id: string };
let db: PrismaClient,
  native: Account,
  attack: Account,
  reset: Account,
  expiry: Account,
  chat: string,
  slug: string,
  personaId: string,
  ownerId: string;
const owner = () => ({
  email: process.env.TEST_ADMIN_EMAIL!,
  password: process.env.TEST_ADMIN_PASSWORD!,
});
let pageErrors: string[] = [],
  outside: string[] = [],
  apiFailures: { path: string; status: number }[] = [];
function watch(context: BrowserContext) {
  function page(p: Page) {
    p.on('pageerror', (e) => pageErrors.push(e.message));
    p.on('response', (r) => {
      if (r.status() >= 400)
        apiFailures.push({ path: new URL(r.url()).pathname, status: r.status() });
    });
  }
  context.pages().forEach(page);
  context.on('page', page);
}
async function guard(context: BrowserContext) {
  watch(context);
  await context.route('**/*', (r) => {
    const url = new URL(r.request().url());
    if (url.origin === 'http://attacker.invalid' && url.pathname === '/login-attack')
      return r.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<meta charset="utf-8"><a href="${origin}/api/v1/auth/session">跨站读取用户会话</a><form method="POST" action="${origin}/api/v1/auth/logout"><input name="x" value="x"><button>跨站退出攻击</button></form>`,
      });
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      outside.push(url.origin);
      return r.abort();
    }
    return r.continue();
  });
}
async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: resolve(proof, name + '.png'), fullPage: true });
}
async function mail(email: string, purpose: 'verify' | 'reset') {
  const directory = process.env.PV_TEST_MAIL_DIR!;
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  let found: { token: string; link: string } | undefined;
  await expect
    .poll(async () => {
      for (const name of await readdir(directory)) {
        if (!name.endsWith('.json')) continue;
        const row = JSON.parse(await readFile(resolve(directory, name), 'utf8'));
        if (row.to === email && row.purpose === purpose) {
          expect((await stat(resolve(directory, name))).mode & 0o777).toBe(0o600);
          found = row;
        }
      }
      return !!found;
    })
    .toBe(true);
  return found!;
}
async function fillLogin(
  page: Page,
  account: Pick<Account, 'email' | 'password'>,
  path = '/login',
) {
  await page.goto(path);
  await page.getByLabel('邮箱', { exact: true }).fill(account.email);
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url() === origin + '/api/v1/auth/login' && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: '登录', exact: true }).click(),
  ]);
  if (response.status() === 200) {
    const headers = (await response.headersArray()).filter(
      (h) => h.name.toLowerCase() === 'set-cookie',
    );
    expect(headers.length).toBe(1);
    expect(/(?:^|;)\s*Domain=/i.test(headers[0]!.value)).toBe(false);
  }
}
async function login(page: Page, account: Pick<Account, 'email' | 'password'>) {
  await fillLogin(page, account);
  await expect(page).toHaveURL(origin + '/account');
  const s = await (await page.request.get('/api/v1/auth/session')).json();
  expect(s.user.email).toBe(account.email);
  return s;
}
async function register(page: Page, attemptUnverified = false): Promise<Account> {
  const a = {
    email: 'login-proof-' + randomUUID() + '@test.invalid',
    password: randomBytes(24).toString('hex'),
    id: '',
  };
  await page.goto('/register');
  await expect(page.getByText('当前仅启用本地模拟邮件，不会向邮箱发送真实邮件。')).toBeVisible();
  await page.getByLabel('邮箱', { exact: true }).fill(a.email);
  await page.getByLabel('显示名称', { exact: true }).fill('TEST ONLY 登录专项');
  await page.getByLabel('密码', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: '创建账户', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('本地模拟环境不会发送真实邮件');
  expect((await page.request.get('/api/v1/auth/session')).status()).toBe(401);
  if (attemptUnverified) {
    await fillLogin(page, a);
    await expect(page.locator('form [role="alert"]')).toContainText(
      '邮箱或密码不正确，或邮箱尚未验证',
    );
    expect((await page.request.get('/api/v1/auth/session')).status()).toBe(401);
  }
  const m = await mail(a.email, 'verify');
  await page.goto(m.link);
  await expect(page.getByRole('button', { name: '验证邮箱', exact: true })).toBeEnabled();
  expect(new URL(page.url()).hash).toBe('');
  await page.getByRole('button', { name: '验证邮箱', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('邮箱已通过服务端验证');
  a.id = (await login(page, a)).user.id;
  return a;
}
async function cookie(context: BrowserContext, name = 'pv_v2_user_local') {
  const c = (await context.cookies()).find((x) => x.name === name);
  expect(!!c).toBe(true);
  return c!;
}
async function assertCookie(page: Page, c: Cookie) {
  expect({
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    path: c.path,
    domain: c.domain,
    secure: c.secure,
  }).toEqual({ httpOnly: true, sameSite: 'Strict', path: '/', domain: '127.0.0.1', secure: false });
  expect(await page.evaluate((value) => document.cookie.includes(value), c.value)).toBe(false);
}
async function browserStatus(
  page: Page,
  path: string,
  method = 'GET',
  data?: unknown,
  csrf?: string,
) {
  return page.evaluate(
    async ({ path, method, data, csrf }) => {
      const r = await fetch('/api/v1' + path, {
        method,
        cache: 'no-store',
        headers: {
          ...(data === undefined ? {} : { 'content-type': 'application/json' }),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: r.status, body: await r.json() };
    },
    { path, method, data, csrf },
  );
}
async function assertExpired(
  page: Page,
  context: BrowserContext,
  account: Account,
  kind: 'idle' | 'absolute',
) {
  const raw = randomBytes(32).toString('hex'),
    now = Date.now();
  await db.userSession.create({
    data: {
      userId: account.id,
      tokenHash: secretHash(raw),
      authVersion: (await db.user.findUniqueOrThrow({ where: { id: account.id } })).authVersion,
      createdAt: new Date(now - (kind === 'idle' ? 2 : 8) * 86400000),
      expiresAt: new Date(kind === 'absolute' ? now - 86400000 : now + 5 * 86400000),
      lastSeenAt: new Date(kind === 'idle' ? now - 25 * 3600000 : now),
    },
  });
  await context.addCookies([
    {
      name: 'pv_v2_user_local',
      value: raw,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Strict',
      expires: Math.floor(now / 1000) + 3600,
    },
  ]);
  expect((await browserStatus(page, '/auth/session')).status).toBe(401);
  await page.goto('/history');
  await expect(page).toHaveURL(origin + '/login?next=%2Fhistory');
  await expect(page.locator('.personal-history-list')).toHaveCount(0);
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.APP_ENV !== 'test' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/personaverse_v2_test' ||
    !/^pv_browser_[a-f0-9]+$/.test(url.searchParams.get('schema') ?? '')
  )
    throw new Error('Fresh isolated login test schema required');
  db = new PrismaClient();
  await mkdir(proof, { recursive: true, mode: 0o700 });
});
test.afterAll(async () => {
  await db?.$disconnect();
});
test.beforeEach(async ({ context }) => {
  pageErrors = [];
  outside = [];
  apiFailures = [];
  await guard(context);
});
test.afterEach(async ({}, info) => {
  await writeFile(
    resolve(proof, info.title.replace(/[^a-z0-9-]/gi, '_') + '.json'),
    JSON.stringify({ pageErrors, outside, apiFailures }, null, 2),
  );
  expect(pageErrors, 'Uncaught browser exceptions').toEqual([]);
  expect(outside, 'Unexpected external network requests').toEqual([]);
});

test('01 Owner native login, cookie, publication/unlisting and admin logout', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('管理员邮箱').fill(owner().email);
  await page.getByLabel('密码', { exact: true }).fill(owner().password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(origin + '/admin');
  const session = (await browserStatus(page, '/admin/auth/session')).body;
  expect(session.admin.role).toBe('owner');
  ownerId = session.admin.id;
  await assertCookie(page, await cookie(page.context(), 'pv_v2_admin_local'));
  expect((await browserStatus(page, '/auth/session')).status).toBe(401);
  await page.goto('/admin/personas/new');
  await page.getByRole('button', { name: '创建空白草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);
  personaId = new URL(page.url()).pathname.split('/')[3]!;
  slug = 'login-proof-' + randomUUID();
  const category = 'TEST ONLY 登录分类 ' + randomUUID().slice(0, 8);
  await page.getByText('新增分类', { exact: true }).click();
  await page.getByLabel('分类名称', { exact: true }).fill(category);
  await page.getByLabel('分类 slug', { exact: true }).fill('login-' + randomUUID());
  await page.getByRole('button', { name: '创建分类', exact: true }).click();
  await expect(page.getByText('分类已创建。')).toBeVisible();
  await page.getByLabel('人格名称', { exact: true }).fill('TEST ONLY 登录流程验收');
  await page.getByLabel('页面标识 slug', { exact: true }).fill(slug);
  await page.getByLabel('简介', { exact: true }).fill('TEST ONLY 原生登录与历史验证');
  await page
    .getByLabel('背景故事', { exact: true })
    .fill('TEST ONLY 隔离测试占位资料，不是正式人格。');
  await page.getByLabel(category, { exact: true }).check();
  await page
    .getByLabel('完整人格内核 · 原文保存', { exact: true })
    .fill('  TEST ONLY ORIGINAL\nNO FORMAL CONTENT  ');
  await page.getByLabel('开场白', { exact: true }).fill('TEST ONLY 本地模拟');
  await page.getByRole('button', { name: '保存草稿并创建版本' }).click();
  await expect(page.getByText('草稿已保存，并创建不可变的新版本。')).toBeVisible();
  await page.getByRole('button', { name: '发布当前草稿', exact: true }).click();
  await expect(page.getByText('当前草稿版本已发布。')).toBeVisible();
  expect((await page.request.get('/api/v1/personas/' + slug)).status()).toBe(200);
  await page.getByRole('button', { name: '下架人格', exact: true }).click();
  await expect(page.getByText('已下架，公开入口已关闭。')).toBeVisible();
  expect((await page.request.get('/api/v1/personas/' + slug)).status()).toBe(404);
  await page.getByRole('button', { name: '发布当前草稿', exact: true }).click();
  await expect(page.getByText('当前草稿版本已发布。')).toBeVisible();
  await screenshot(page, '01-owner-native');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(origin + '/admin/login');
  expect((await browserStatus(page, '/admin/auth/session')).status).toBe(401);
});

test('02 registration, verification, password login, logout replay rejection, relogin and independent device history', async ({
  page,
  browser,
}) => {
  native = await register(page, true);
  const c = await cookie(page.context());
  await assertCookie(page, c);
  const stored = await db.userSession.findUniqueOrThrow({
    where: { tokenHash: secretHash(c.value) },
  });
  expect(stored.tokenHash === c.value).toBe(false);
  await page.goto('/chat/' + slug);
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]{36}$/);
  chat = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByTestId('session-id')).toHaveText(chat);
  await page
    .getByRole('textbox', { name: '消息', exact: true })
    .fill('TEST ONLY 登录后保存的私有消息');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await page.goto('/account');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(origin + '/login');
  expect((await page.context().cookies()).some((x) => x.name === 'pv_v2_user_local')).toBe(false);
  expect(
    (await db.userSession.findUniqueOrThrow({ where: { id: stored.id } })).revokedAt !== null,
  ).toBe(true);
  const stale = await browser.newContext({ baseURL: origin });
  await guard(stale);
  await stale.addCookies([c]);
  const replay = await stale.newPage();
  await replay.goto('/account');
  await expect(replay).toHaveURL(origin + '/login?next=%2Faccount');
  expect((await browserStatus(replay, '/auth/session')).status).toBe(401);
  await stale.close();
  await login(page, native);
  await page.goto('/history/' + chat);
  await expect(page.locator('.message.user')).toContainText('登录后保存的私有消息');
  const device = await browser.newContext({ baseURL: origin });
  await guard(device);
  const second = await device.newPage();
  await login(second, native);
  expect((await cookie(device)).value === (await cookie(page.context())).value).toBe(false);
  await second.goto('/history');
  await second.getByRole('link', { name: /TEST ONLY 登录流程验收/ }).click();
  await expect(second.getByTestId('session-id')).toHaveText(chat);
  await expect(second.locator('.message.user')).toContainText('登录后保存的私有消息');
  await second.reload();
  await expect(second.locator('.message.user')).toContainText('登录后保存的私有消息');
  await screenshot(second, '02-native-cross-device');
  await device.close();
});

test('03 browser CSRF rejection, independent session CSRF and valid native writes', async ({
  page,
  browser,
}) => {
  attack = await register(page);
  expect((await browserStatus(page, '/me', 'PUT', { displayName: 'MUST NOT SAVE' })).status).toBe(
    403,
  );
  expect(
    (await browserStatus(page, '/me', 'PUT', { displayName: 'MUST NOT SAVE' }, 'wrong')).status,
  ).toBe(403);
  const device = await browser.newContext({ baseURL: origin });
  await guard(device);
  const second = await device.newPage();
  const foreign = await login(second, attack);
  expect(
    (await browserStatus(page, '/me', 'PUT', { displayName: 'MUST NOT SAVE' }, foreign.csrfToken))
      .status,
  ).toBe(403);
  await page.getByLabel('显示名称', { exact: true }).fill('TEST ONLY CSRF 正常保存');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByText('个人资料已保存。', { exact: true })).toBeVisible();
  await device.close();
  const anonymous = await browser.newContext({ baseURL: origin });
  await guard(anonymous);
  const guest = await anonymous.newPage();
  await guest.goto('/login');
  expect(
    (
      await browserStatus(guest, '/auth/login', 'POST', {
        email: attack.email,
        password: attack.password,
      })
    ).status,
  ).toBe(403);
  expect((await browserStatus(guest, '/auth/session')).status).toBe(401);
  await anonymous.close();
  await screenshot(page, '03-csrf-native-write');
});

test('04 password reset through private test mailbox revokes both devices and rejects expired or reused tokens', async ({
  page,
  browser,
}) => {
  reset = await register(page);
  const device = await browser.newContext({ baseURL: origin });
  await guard(device);
  const second = await device.newPage();
  await login(second, reset);
  const raw = randomBytes(32).toString('hex'),
    now = Date.now();
  await db.passwordReset.create({
    data: {
      userId: reset.id,
      authVersion: 1,
      tokenHash: secretHash(raw),
      createdAt: new Date(now - 31 * 60000),
      expiresAt: new Date(now - 16 * 60000),
      deliveredAt: new Date(now - 31 * 60000),
    },
  });
  await page.goto('/reset-password#token=' + raw);
  await page.getByLabel('新密码', { exact: true }).fill(randomBytes(24).toString('hex'));
  await page.getByRole('button', { name: '更新密码', exact: true }).click();
  await expect(page.locator('form [role="alert"]')).toBeVisible();
  expect((await browserStatus(second, '/auth/session')).status).toBe(200);
  await page.goto('/forgot-password');
  await expect(page.getByText('当前仅启用本地模拟邮件，不会向邮箱发送真实邮件。')).toBeVisible();
  await page.getByLabel('邮箱', { exact: true }).fill(reset.email);
  await page.getByRole('button', { name: '申请重置密码', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('系统会安排重置通知');
  const m = await mail(reset.email, 'reset');
  const password = randomBytes(24).toString('hex');
  await page.goto(m.link);
  await expect(page.getByRole('button', { name: '更新密码', exact: true })).toBeEnabled();
  expect(new URL(page.url()).hash).toBe('');
  await page.getByLabel('新密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '更新密码', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('旧登录会话已撤销');
  expect((await browserStatus(second, '/auth/session')).status).toBe(401);
  await second.goto('/account');
  await expect(second).toHaveURL(origin + '/login?next=%2Faccount');
  await fillLogin(page, reset);
  await expect(page.locator('form [role="alert"]')).toContainText('邮箱或密码不正确');
  expect((await browserStatus(page, '/auth/session')).status).toBe(401);
  reset.password = password;
  await login(page, reset);
  await screenshot(page, '04-reset-native-login');
  await page.goto(m.link);
  await expect(page.getByRole('button', { name: '更新密码', exact: true })).toBeEnabled();
  await page.getByLabel('新密码', { exact: true }).fill(randomBytes(24).toString('hex'));
  await page.getByRole('button', { name: '更新密码', exact: true }).click();
  await expect(page.locator('form [role="alert"]')).toBeVisible();
  expect((await browserStatus(page, '/auth/session')).status).toBe(200);
  await device.close();
});

test('05 actual browser rejects idle and absolute expired server sessions without reducing configured TTL', async ({
  page,
  context,
}) => {
  expiry = await register(page);
  await assertExpired(page, context, expiry, 'idle');
  await login(page, expiry);
  await assertExpired(page, context, expiry, 'absolute');
  await login(page, expiry);
  await screenshot(page, '05-expiry-recovered-login');
});

test('06 Owner idle and absolute expiry redirect to admin login and never grant user identity', async ({
  page,
  context,
}) => {
  for (const kind of ['idle', 'absolute'] as const) {
    const raw = randomBytes(32).toString('hex'),
      now = Date.now();
    await db.adminSession.create({
      data: {
        adminId: ownerId,
        authVersion: 1,
        tokenHash: secretHash(raw),
        createdAt: new Date(now - (kind === 'idle' ? 2 : 13) * 3600000),
        expiresAt: new Date(kind === 'absolute' ? now - 3600000 : now + 10 * 3600000),
        lastSeenAt: new Date(kind === 'idle' ? now - 31 * 60000 : now),
      },
    });
    await context.addCookies([
      {
        name: 'pv_v2_admin_local',
        value: raw,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Strict',
        expires: Math.floor(now / 1000) + 3600,
      },
    ]);
    await page.goto('/admin');
    await expect(page).toHaveURL(origin + '/admin/login');
    expect((await browserStatus(page, '/admin/auth/session')).status).toBe(401);
    expect((await browserStatus(page, '/auth/session')).status).toBe(401);
  }
  await screenshot(page, '06-owner-expiry');
});

test('07 login destination rejects external, protocol-relative and encoded administrator paths', async ({
  page,
}) => {
  for (const next of ['https://outside.invalid/', '//outside.invalid/', '/admin', '/%61dmin']) {
    await fillLogin(page, expiry, '/login?next=' + encodeURIComponent(next));
    await expect(page).toHaveURL(origin + '/account');
  }
  await fillLogin(page, expiry, '/login?next=' + encodeURIComponent('/history'));
  await expect(page).toHaveURL(origin + '/history');
  await screenshot(page, '07-safe-login-destination');
});

test('08 disabled Rengine exposes no unfinished login UI or callback and does not disrupt native session', async ({
  page,
}) => {
  await login(page, native);
  const before = (await browserStatus(page, '/auth/session')).body.user.id;
  expect((await browserStatus(page, '/auth/rengine/capabilities')).body).toEqual({
    enabled: false,
    mode: 'disabled',
  });
  expect((await browserStatus(page, '/auth/rengine')).body).toMatchObject({
    enabled: false,
    mode: 'disabled',
  });
  await expect(page.getByRole('button', { name: /热土|REngine/i })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '热土身份绑定 · MOCK' })).toHaveCount(0);
  const s = (await browserStatus(page, '/auth/session')).body;
  expect(
    (
      await browserStatus(
        page,
        '/auth/rengine/start',
        'POST',
        { password: native.password },
        s.csrfToken,
      )
    ).body.error.code,
  ).toBe('EXTERNAL_AUTH_DISABLED');
  let finalizeRequests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/auth/rengine/finalize')) finalizeRequests++;
  });
  const response = await page.goto(
    '/auth/rengine/callback?type=code&v=untrusted-code&state=' + randomBytes(32).toString('hex'),
  );
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: '热土身份绑定 · MOCK' })).toHaveCount(0);
  expect(finalizeRequests).toBe(0);
  await page.goto('/account');
  expect((await browserStatus(page, '/auth/session')).body.user.id).toBe(before);
  expect(await db.externalIdentity.count()).toBe(0);
  expect(await db.externalAuthTransaction.count()).toBe(0);
  await screenshot(page, '08-rengine-off-native-session');
});

test('09 browser user isolation rejects cross-user reads and all administrator calls', async ({
  page,
}) => {
  await login(page, reset);
  const s = (await browserStatus(page, '/auth/session')).body;
  expect((await browserStatus(page, '/me/chats/' + chat)).status).toBe(404);
  expect((await browserStatus(page, '/me/chats/' + chat, 'DELETE', {}, s.csrfToken)).status).toBe(
    404,
  );
  expect((await browserStatus(page, '/admin/personas')).status).toBe(401);
  expect((await browserStatus(page, '/admin/personas', 'POST', {}, s.csrfToken)).status).toBe(401);
  await page.goto('/admin');
  await expect(page).toHaveURL(origin + '/admin/login');
  expect((await browserStatus(page, '/auth/session')).body.user.id).toBe(reset.id);
});

test('10 Strict cookie blocks cross-site session and Origin rejects browser form attack without logging user out', async ({
  page,
}) => {
  await login(page, native);
  await page.goto('http://attacker.invalid/login-attack');
  const [cross] = await Promise.all([
    page.waitForResponse(
      (r) => r.url() === origin + '/api/v1/auth/session' && r.request().isNavigationRequest(),
    ),
    page.getByRole('link', { name: '跨站读取用户会话' }).click(),
  ]);
  expect(cross.status()).toBe(401);
  expect(
    /(?:^|;\s*)pv_v2_user_local=/.test((await cross.request().allHeaders()).cookie ?? ''),
  ).toBe(false);
  await page.goto('http://attacker.invalid/login-attack');
  const [attack] = await Promise.all([
    page.waitForResponse(
      (r) => r.url() === origin + '/api/v1/auth/logout' && r.request().isNavigationRequest(),
    ),
    page.getByRole('button', { name: '跨站退出攻击' }).click(),
  ]);
  expect(attack.status()).toBe(403);
  expect(await attack.json()).toMatchObject({ error: { code: 'ORIGIN_REJECTED' } });
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/account';
    link.textContent = '回到本站';
    document.body.append(link);
  });
  await page.getByRole('link', { name: '回到本站' }).click();
  await expect(page).toHaveURL(origin + '/account');
  expect((await browserStatus(page, '/auth/session')).body.user.id).toBe(native.id);
  await screenshot(page, '10-strict-origin-preserved');
});
