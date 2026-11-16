import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const fresh = () => ({
  email: 'personaverse-' + randomUUID() + '@test.invalid',
  password: randomUUID() + randomUUID(),
});
type Mail = { to: string; purpose: 'verify' | 'reset'; token: string; link: string };
async function mail(to: string, purpose: Mail['purpose']) {
  const directory = process.env.PV_TEST_MAIL_DIR;
  if (!directory) throw new Error('Private local mail fixture directory required');
  let found: Mail | undefined;
  await expect
    .poll(
      async () => {
        for (const file of await readdir(directory).catch(() => [])) {
          if (!file.endsWith('.json')) continue;
          try {
            const row = JSON.parse(await readFile(join(directory, file), 'utf8')) as Mail;
            if (row.to === to && row.purpose === purpose) found = row;
          } catch {}
        }
        return !!found;
      },
      {
        timeout: 10000,
        message: 'Expected a local simulated mail fixture without exposing its token',
      },
    )
    .toBe(true);
  return found!;
}
async function anonymous(api: APIRequestContext, origin: string, path: string, data: unknown) {
  const pre = await api.get('/api/v1/auth/csrf');
  expect(pre.status()).toBe(200);
  return api.post('/api/v1/auth/' + path, {
    headers: { origin, 'x-csrf-token': (await pre.json()).csrfToken },
    data,
  });
}
async function verified(api: APIRequestContext, origin: string, account: ReturnType<typeof fresh>) {
  expect(
    (
      await anonymous(api, origin, 'register', { ...account, displayName: 'TEST ONLY 用户' })
    ).status(),
  ).toBe(202);
  const received = await mail(account.email, 'verify');
  expect((await anonymous(api, origin, 'verify', { token: received.token })).status()).toBe(200);
}
async function login(page: Page, account: ReturnType<typeof fresh>) {
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill(account.email);
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  expect((await page.request.get('/api/v1/auth/session')).status()).toBe(200);
}
async function conversationId(page: Page) {
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  // Navigation can commit before the new PersonalChat has read the persisted session.
  await expect(page.getByTestId('session-id')).toHaveText(id);
  return id;
}
async function userHeaders(api: APIRequestContext, origin: string) {
  const session = await api.get('/api/v1/auth/session');
  expect(session.status()).toBe(200);
  return { origin, 'x-csrf-token': (await session.json()).csrfToken };
}
async function persona(api: APIRequestContext, origin: string) {
  const pre = await api.get('/api/v1/admin/auth/csrf');
  expect(pre.status()).toBe(200);
  const logged = await api.post('/api/v1/admin/auth/login', {
    headers: { origin, 'x-csrf-token': (await pre.json()).csrfToken },
    data: { email: process.env.TEST_ADMIN_EMAIL, password: process.env.TEST_ADMIN_PASSWORD },
  });
  expect(logged.status()).toBe(200);
  const session = await api.get('/api/v1/admin/auth/session');
  expect(session.status()).toBe(200);
  const headers = { origin, 'x-csrf-token': (await session.json()).csrfToken };
  const category = await api.post('/api/v1/admin/categories', {
    headers,
    data: { name: 'TEST ONLY ' + randomUUID(), slug: 'test-' + randomUUID() },
  });
  expect(category.status()).toBe(200);
  const draft = await api.post('/api/v1/admin/personas', { headers, data: {} });
  expect(draft.status()).toBe(201);
  const initial = await draft.json();
  const slug = 'user-test-' + randomUUID();
  const saved = await api.put('/api/v1/admin/personas/' + initial.id, {
    headers,
    data: {
      expectedRevision: 0,
      name: 'TEST ONLY 个人记录 ' + randomUUID(),
      slug,
      summary: 'TEST ONLY 独立测试资料',
      background: 'TEST ONLY 本地测试，不是正式人格。',
      avatarUrl: '',
      tags: ['TEST ONLY'],
      categoryIds: [(await category.json()).id],
      coreText: '  TEST ONLY ORIGINAL SOURCE\n  ',
      openingMessage: 'TEST ONLY OPEN',
    },
  });
  expect(saved.status()).toBe(200);
  const version = await saved.json();
  const published = await api.post('/api/v1/admin/personas/' + initial.id + '/publish', {
    headers,
    data: { expectedRevision: version.revision, expectedVersionId: version.draftVersionId },
  });
  expect(published.status()).toBe(200);
  return {
    ...((await published.json()) as { id: string; revision: number; name: string }),
    slug,
    headers,
  };
}

test('mobile registration, private simulated verification and confirmed user login', async ({
  page,
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin,
    account = fresh();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill(account.email);
  await page.getByLabel('显示名称', { exact: true }).fill('TEST ONLY 移动用户');
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '创建账户', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('本地模拟环境不会发送真实邮件');
  const before = await page.request.get('/api/v1/auth/session');
  expect(before.status()).toBe(401);
  const received = await mail(account.email, 'verify');
  await page.goto(new URL(received.link).pathname + '#token=' + received.token);
  await expect(page.getByRole('button', { name: '验证邮箱', exact: true })).toBeEnabled();
  expect(new URL(page.url()).hash).toBe('');
  await page.getByRole('button', { name: '验证邮箱', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('邮箱已通过服务端验证');
  await login(page, account);
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  expect(session.user.email).toBe(account.email);
  expect(session.user.emailVerifiedAt).toBeTruthy();
  const cookie = (await page.context().cookies()).find((row) => row.name === 'pv_v2_user_local');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');
  await page.getByLabel('显示名称', { exact: true }).fill('TEST ONLY 已更新');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByText('个人资料已保存。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: 'test-results/users-account-' + new URL(origin).port + '.png',
    fullPage: true,
  });
  expect((await request.get('/api/v1/admin/personas')).status()).toBe(401);
});

test('two devices restore personal chats and favorites while other users and admin stay isolated', async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin,
    a = fresh(),
    b = fresh();
  await verified(page.request, origin, a);
  const visitor = await browser.newContext({ baseURL: origin });
  const outsider = await visitor.newPage();
  await verified(outsider.request, origin, b);
  const p = await persona(request, origin);
  await login(page, a);
  let releaseHistory!: () => void;
  const historyReleased = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  let historyStarted = false;
  await page.route(/\/api\/v1\/me\/chats\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() === 'GET' && !historyStarted) {
      historyStarted = true;
      await historyReleased;
    }
    await route.continue();
  });
  await page.goto('/chat/' + p.slug);
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]{36}$/);
  await expect.poll(() => historyStarted).toBe(true);
  await expect(page.getByTestId('session-id')).toHaveText('尚未建立');
  releaseHistory();
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]+$/);
  const id = await conversationId(page);
  const content = 'TEST ONLY PRIVATE ' + randomUUID();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill(content);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.message.user')).toContainText(content);
  await page.goto('/persona/' + p.slug);
  const favorite = page.getByRole('button', { name: '收藏' + p.slug, exact: true });
  await expect(favorite).toBeEnabled();
  await favorite.click();
  await expect(
    page.getByRole('button', { name: '取消收藏' + p.slug, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const device = await browser.newContext({ baseURL: origin });
  const second = await device.newPage();
  await login(second, a);
  await second.goto('/history');
  await expect(second.getByRole('link', { name: new RegExp(p.name) })).toBeVisible();
  await second.goto('/history/' + id);
  await expect(second.locator('.message.user')).toContainText(content);
  expect(await conversationId(second)).toBe(id);
  await second.reload();
  expect(await conversationId(second)).toBe(id);
  await expect(second.locator('.message.user')).toContainText(content);
  await second.goto('/favorites');
  await expect(second.getByRole('heading', { name: p.name, exact: true })).toBeVisible();
  await login(outsider, b);
  expect((await outsider.request.get('/api/v1/me/chats/' + id)).status()).toBe(404);
  expect(
    (
      await outsider.request.delete('/api/v1/me/chats/' + id, {
        headers: await userHeaders(outsider.request, origin),
        data: {},
      })
    ).status(),
  ).toBe(404);
  expect((await request.get('/api/v1/me/chats/' + id)).status()).toBe(401); // An administrator cookie does not grant user access.
  const list = await (await outsider.request.get('/api/v1/me/chats')).json();
  expect(list.items).toHaveLength(0);
  // A second tab in this device must stop displaying this account's collection after logout.
  const accountTab = await device.newPage();
  await accountTab.goto('/account');
  await accountTab.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(accountTab).toHaveURL(/\/login$/);
  await expect(second).toHaveURL(/\/login\?next=%2Ffavorites$/);
  await expect(second.getByRole('heading', { name: p.name, exact: true })).toHaveCount(0);
  expect((await second.request.get('/api/v1/me/favorites')).status()).toBe(401);
  expect((await page.request.get('/api/v1/auth/session')).status()).toBe(200);
  await visitor.close();
  await device.close();
});

test('password reset revokes old device sessions and logout is confirmed by the server', async ({
  page,
  browser,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin,
    account = fresh();
  await verified(page.request, origin, account);
  await login(page, account);
  const other = await browser.newContext({ baseURL: origin });
  const second = await other.newPage();
  await login(second, account);
  await page.goto('/forgot-password');
  await page.getByLabel('邮箱', { exact: true }).fill(account.email);
  await page.getByRole('button', { name: '申请重置密码', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('系统会安排重置通知');
  const received = await mail(account.email, 'reset');
  const next = randomUUID() + randomUUID();
  await page.goto(new URL(received.link).pathname + '#token=' + received.token);
  await expect(page.getByRole('button', { name: '更新密码', exact: true })).toBeEnabled();
  await page.getByLabel('新密码', { exact: true }).fill(next);
  await page.getByRole('button', { name: '更新密码', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('旧登录会话已撤销');
  expect((await second.request.get('/api/v1/auth/session')).status()).toBe(401);
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill(account.email);
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await page.request.get('/api/v1/auth/session')).status()).toBe(401);
  await login(page, { ...account, password: next });
  // Reproduce the auth-revocation/focus race while an intentional logout is in progress.
  // The boundary must stay fail-closed without replacing the confirmed /login destination.
  await page.route('**/api/v1/auth/logout', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/v1/auth/session')).status()).toBe(401);
  await other.close();
});

test('idempotent messages, retained unlisted history, deletion and account closure', async ({
  page,
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin,
    account = fresh();
  await verified(page.request, origin, account);
  const p = await persona(request, origin);
  await login(page, account);
  await page.goto('/chat/' + p.slug);
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]+$/);
  const id = await conversationId(page);
  const headers = await userHeaders(page.request, origin),
    body = { clientMessageId: randomUUID(), content: 'TEST ONLY IDEMPOTENT' };
  for (let n = 0; n < 2; n++)
    expect(
      (
        await page.request.post('/api/v1/me/chats/' + id + '/messages', { headers, data: body })
      ).status(),
    ).toBe(200);
  const saved = await (await page.request.get('/api/v1/me/chats/' + id)).json();
  expect(saved.messages.filter((m: { role: string }) => m.role === 'user')).toHaveLength(1);
  expect(
    (
      await request.post('/api/v1/admin/personas/' + p.id + '/unpublish', {
        headers: p.headers,
        data: { expectedRevision: p.revision },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(page.locator('.message.user')).toContainText(body.content);
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeDisabled();
  const denied = await page.request.post('/api/v1/me/chats/' + id + '/messages', {
    headers: await userHeaders(page.request, origin),
    data: { clientMessageId: randomUUID(), content: 'TEST NO NEW MESSAGE' },
  });
  expect([404, 409]).toContain(denied.status());
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除这段聊天', exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  expect((await page.request.get('/api/v1/me/chats/' + id)).status()).toBe(404);
  expect(
    (
      await page.request.post('/api/v1/me/chats/' + id + '/messages', {
        headers: await userHeaders(page.request, origin),
        data: { clientMessageId: randomUUID(), content: 'TEST DENIED' },
      })
    ).status(),
  ).toBe(404);
  await page.goto('/account');
  await page.getByRole('button', { name: '查看注销确认', exact: true }).click();
  await page.getByLabel('确认当前密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '确认注销账户并删除个人记录', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?closed=1$/);
  expect((await page.request.get('/api/v1/auth/session')).status()).toBe(401);
});

test('explicit mock external binding preserves local account and multi-cookie response', async ({
  page,
  baseURL,
}) => {
  const account = fresh();
  await verified(page.request, new URL(baseURL!).origin, account);
  await login(page, account);
  const before = await (await page.request.get('/api/v1/auth/session')).json();
  await page.getByLabel('绑定热土确认密码').fill(account.password);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/auth/rengine/finalize') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '开始模拟热土绑定' }).click();
  await expect(page.getByRole('status')).toHaveText('热土身份已绑定（模拟验证）。');
  const result = await response;
  expect(result.status()).toBe(200);
  const cookies = (await result.headersArray()).filter(
    (x) => x.name.toLowerCase() === 'set-cookie',
  );
  expect(cookies).toHaveLength(2);
  expect((await page.context().cookies()).some((x) => x.name === 'pv_rengine_flow_local')).toBe(
    false,
  );
  expect((await page.context().cookies()).some((x) => x.name === 'pv_v2_user_login_local')).toBe(
    false,
  );
  expect(new URL(page.url()).search).toBe('');
  expect((await (await page.request.get('/api/v1/auth/session')).json()).user.id).toBe(
    before.user.id,
  );
  await page.getByRole('link', { name: '返回个人中心' }).click();
  await expect(page.getByText('热土身份已绑定（模拟验证）。', { exact: true })).toBeVisible();
});
