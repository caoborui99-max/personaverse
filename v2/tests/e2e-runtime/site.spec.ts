import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = resolve('.local-preview');
const origin = 'http://127.0.0.1:4310';
type Account = { email: string; password: string };
type Fixture = {
  owner: Account;
  viewer: Account;
  user?: Account;
  outsider?: Account;
  slug?: string;
  personaId?: string;
  chatId?: string;
  retainedId?: string;
  core?: string;
  deletedUserId?: string;
  deletedChatId?: string;
  name?: string;
};
let fixture: Fixture;
let errors: string[] = [],
  failures: { path: string; status: number }[] = [],
  consoleErrors: { path: string; text: string }[] = [],
  external: string[] = [];
const allowed = new Set<string>();
const urlPath = (value: string) => {
  try {
    return new URL(value, origin).pathname;
  } catch {
    return '[invalid-url]';
  }
};
function permit(path: string, status: number) {
  allowed.add(path + ':' + status);
}
async function observe(context: BrowserContext) {
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (['http:', 'https:'].includes(u.protocol) && u.origin !== origin) {
      external.push(u.origin);
      return route.abort();
    }
    return route.continue();
  });
  function watch(page: Page) {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (r) => {
      if (r.status() >= 400) failures.push({ path: urlPath(r.url()), status: r.status() });
    });
    page.on('console', (m) => {
      if (m.type() === 'error')
        consoleErrors.push({ path: urlPath(m.location().url), text: m.text() });
    });
  }
  context.pages().forEach(watch);
  context.on('page', watch);
}
async function capture(page: Page, name: string) {
  await mkdir(resolve(root, 'evidence'), { recursive: true, mode: 0o700 });
  await page.screenshot({ path: resolve(root, 'evidence', name + '.png'), fullPage: true });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
async function save() {
  await writeFile(resolve(root, 'journey-private.json'), JSON.stringify(fixture), { mode: 0o600 });
}
async function adminLogin(page: Page, account: Account) {
  await page.goto('/admin/login');
  await page.getByLabel('管理员邮箱').fill(account.email);
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  return (await (await page.request.get('/api/v1/admin/auth/session')).json()).admin;
}
async function userLogin(page: Page, account: Account) {
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill(account.email);
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  expect((await page.request.get('/api/v1/auth/session')).status()).toBe(200);
}
async function register(page: Page): Promise<Account> {
  const account = {
    email: 'runtime-' + randomUUID() + '@test.invalid',
    password: randomBytes(24).toString('hex'),
  };
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill(account.email);
  await page.getByLabel('显示名称', { exact: true }).fill('TEST ONLY 本地用户');
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '创建账户', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('本地模拟环境不会发送真实邮件');
  let link: string | undefined;
  await expect
    .poll(async () => {
      for (const file of await readdir(resolve(root, 'mail'))) {
        const mail = JSON.parse(await readFile(resolve(root, 'mail', file), 'utf8'));
        if (mail.to === account.email && mail.purpose === 'verify') link = mail.link;
      }
      return !!link;
    })
    .toBe(true);
  await page.goto(link!);
  await expect(page.getByRole('button', { name: '验证邮箱', exact: true })).toBeEnabled();
  expect(new URL(page.url()).hash).toBe('');
  await page.getByRole('button', { name: '验证邮箱', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('邮箱已通过服务端验证');
  await userLogin(page, account);
  return account;
}
async function chatId(page: Page) {
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByTestId('session-id')).toHaveText(id);
  return id;
}
async function turns(page: Page, count: number) {
  for (let n = 1; n <= count; n++) {
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await expect(input).toBeEnabled();
    await input.fill('TEST ONLY runtime message ' + n);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.locator('.message.user')).toHaveCount(n);
    await expect(page.locator('.message.assistant')).toHaveCount(n);
    await expect(page.locator('.message.assistant').last()).toBeInViewport({ ratio: 0.5 });
    await expect(input).toHaveValue('');
    await expect(input).toBeEnabled();
  }
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const state = JSON.parse(await readFile(resolve(root, 'private-state.json'), 'utf8'));
  fixture = { owner: state.owner, viewer: state.viewer };
  expect((await fetch(origin + '/api/v1/health')).status).toBe(200);
});
test.beforeEach(async ({ context }) => {
  errors = [];
  failures = [];
  consoleErrors = [];
  external = [];
  allowed.clear();
  await observe(context);
});
test.afterEach(async ({}, info) => {
  const unexpected = failures.filter((r) => !allowed.has(r.path + ':' + r.status));
  const unexpectedConsole = consoleErrors.filter((r) => {
    const match = r.text.match(/status of (\d{3})/);
    return !match || !allowed.has(r.path + ':' + match[1]);
  });
  await mkdir(resolve(root, 'diagnostics'), { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(root, 'diagnostics', info.title.replace(/[^a-zA-Z0-9-]/g, '_') + '.json'),
    JSON.stringify(
      {
        pageErrors: errors,
        httpFailures: failures,
        unexpected,
        consoleErrors,
        unexpectedConsole,
        external,
      },
      null,
      2,
    ),
  );
  expect(external, 'No browser request may leave the local application').toEqual([]);
  expect(errors, 'No uncaught browser exception').toEqual([]);
  expect(unexpected, 'Unexpected HTTP failures').toEqual([]);
  expect(unexpectedConsole, 'Unexpected console errors').toEqual([]);
});

test('01 Owner browser creates, saves, publishes, unlists and republishes TEST ONLY fixture', async ({
  page,
  browser,
}) => {
  expect((await adminLogin(page, fixture.owner)).role).toBe('owner');
  await page.getByRole('link', { name: '管理人格 ↗', exact: true }).click();
  await page.getByRole('link', { name: '新建草稿 ＋' }).click();
  await page.getByRole('button', { name: '创建空白草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);
  fixture.personaId = new URL(page.url()).pathname.split('/')[3]!;
  await expect(page.getByLabel('人格名称', { exact: true })).toHaveValue('');
  const categoryName = 'TEST ONLY 本地验收 ' + randomUUID().slice(0, 8);
  await page.getByText('新增分类', { exact: true }).click();
  await page.getByLabel('分类名称', { exact: true }).fill(categoryName);
  await page.getByLabel('分类 slug', { exact: true }).fill('runtime-' + randomUUID());
  await page.getByRole('button', { name: '创建分类', exact: true }).click();
  await expect(page.getByText('分类已创建。')).toBeVisible();
  fixture.slug = 'runtime-' + randomUUID();
  fixture.name = 'TEST ONLY 本地运行验收 ' + randomUUID().slice(0, 8);
  fixture.core = '  TEST ONLY ORIGINAL FIXTURE\nNo production persona content.  ';
  await page.getByLabel('人格名称', { exact: true }).fill(fixture.name);
  await page.getByLabel('页面标识 slug', { exact: true }).fill(fixture.slug);
  await page.getByLabel('简介', { exact: true }).fill('TEST ONLY · 隔离数据库浏览器验收资料');
  await page
    .getByLabel('背景故事', { exact: true })
    .fill('TEST ONLY：仅为本地验收占位资料，不是正式人格故事。');
  await page.getByLabel(categoryName, { exact: true }).check();
  await page.getByLabel('完整人格内核 · 原文保存', { exact: true }).fill(fixture.core);
  await page.getByLabel('开场白', { exact: true }).fill('TEST ONLY 本地模拟会话。');
  await page.getByRole('button', { name: '保存草稿并创建版本' }).click();
  await expect(page.getByText('草稿已保存，并创建不可变的新版本。')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('完整人格内核 · 原文保存')).toHaveValue(fixture.core);
  const guestContext = await browser.newContext({ baseURL: origin });
  await observe(guestContext);
  const guest = await guestContext.newPage();
  permit('/persona/' + fixture.slug, 404);
  permit('/api/v1/me/favorites/' + fixture.slug, 401);
  expect((await guest.goto('/persona/' + fixture.slug))?.status()).toBe(404);
  await page.getByRole('button', { name: '发布当前草稿', exact: true }).click();
  await expect(page.getByText('当前草稿版本已发布。')).toBeVisible();
  expect((await guest.goto('/persona/' + fixture.slug))?.status()).toBe(200);
  await page.getByRole('button', { name: '下架人格', exact: true }).click();
  await expect(page.getByText('已下架，公开入口已关闭。')).toBeVisible();
  expect((await guest.goto('/persona/' + fixture.slug))?.status()).toBe(404);
  await page.getByRole('button', { name: '发布当前草稿', exact: true }).click();
  await expect(page.getByText('当前草稿版本已发布。')).toBeVisible();
  await noOverflow(page);
  await capture(page, '01-owner-editor-mobile');
  await save();
  await guestContext.close();
});

test('02 public discovery, email registration, verified login, 20 Fake chat turns and refresh', async ({
  page,
}) => {
  const catalogue = await (await page.request.get('/api/v1/personas?limit=50')).json();
  for (const item of catalogue.items) permit('/api/v1/me/favorites/' + item.slug, 401);
  expect((await page.goto('/'))?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: fixture.name!, exact: true })).toBeVisible();
  await noOverflow(page);
  await capture(page, '02-home-mobile');
  await page.getByRole('link', { name: /探索人格宇宙/ }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await page.getByRole('textbox', { name: '搜索人格' }).fill('本地运行验收');
  await expect(page.getByRole('heading', { name: fixture.name!, exact: true })).toBeVisible();
  await capture(page, '03-explore-search');
  await page.goto('/persona/' + fixture.slug);
  await expect(page.getByRole('heading', { name: fixture.name!, exact: true })).toBeVisible();
  await noOverflow(page);
  await capture(page, '04-persona-detail');
  fixture.user = await register(page);
  const externalState = await (await page.request.get('/api/v1/auth/rengine')).json();
  expect(externalState).toMatchObject({ enabled: false, mode: 'disabled' });
  await expect(page.getByRole('heading', { name: '热土身份绑定 · MOCK' })).toHaveCount(0);
  await capture(page, '05-user-account');
  await page.goto('/');
  const card = page
    .locator('.persona-card')
    .filter({ has: page.getByRole('heading', { name: fixture.name!, exact: true }) });
  await card.getByRole('link', { name: /开始/ }).click();
  fixture.chatId = await chatId(page);
  await turns(page, 20);
  await page.reload();
  await expect(page.getByTestId('session-id')).toHaveText(fixture.chatId);
  await expect(page.locator('.message.user')).toHaveCount(20);
  await expect(page.locator('.message.assistant')).toHaveCount(20);
  await expect(page.locator('.message.assistant').last()).toBeInViewport({ ratio: 0.5 });
  await noOverflow(page);
  await capture(page, '06-chat-mobile-20-turns');
  await page.goto('/persona/' + fixture.slug);
  const favorite = page.getByRole('button', { name: '收藏' + fixture.slug, exact: true });
  await expect(favorite).toBeEnabled();
  await favorite.click();
  await expect(
    page.getByRole('button', { name: '取消收藏' + fixture.slug, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await save();
});

test('03 independent device restores history and favorites; logout blocks private pages', async ({
  browser,
}) => {
  const device = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  await observe(device);
  const second = await device.newPage();
  await userLogin(second, fixture.user!);
  await second.goto('/history');
  await expect(second.getByRole('link', { name: new RegExp(fixture.name!) })).toBeVisible();
  await second.getByRole('link', { name: new RegExp(fixture.name!) }).click();
  await expect(second.getByTestId('session-id')).toHaveText(fixture.chatId!);
  await expect(second.locator('.message.user')).toHaveCount(20);
  await expect(second.locator('.message.assistant').last()).toBeInViewport({ ratio: 0.5 });
  await capture(second, '07-second-device-history');
  await second.goto('/favorites');
  await expect(second.getByRole('heading', { name: fixture.name!, exact: true })).toBeVisible();
  await second.reload();
  await expect(second.getByRole('heading', { name: fixture.name!, exact: true })).toBeVisible();
  await capture(second, '08-favorites-restored');
  await second.goto('/account');
  permit('/api/v1/auth/session', 401);
  permit('/api/v1/auth/rengine', 401);
  await second.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(second).toHaveURL(/\/login$/);
  expect((await second.request.get('/api/v1/auth/session')).status()).toBe(401);
  await second.goto('/history');
  await expect(second).toHaveURL(/\/login\?next=%2Fhistory$/);
  await second.goto('/favorites');
  await expect(second).toHaveURL(/\/login\?next=%2Ffavorites$/);
  await device.close();
});

test('04 Viewer cannot create, edit, publish, unlist or read private user conversations', async ({
  page,
}) => {
  expect((await adminLogin(page, fixture.viewer)).role).toBe('viewer');
  await expect(page.locator('.admin-bar')).toContainText('viewer');
  await page.goto('/admin/personas/new');
  permit('/api/v1/admin/personas', 403);
  await page.getByRole('button', { name: '创建空白草稿', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '当前账户没有修改权限。' })).toHaveText(
    '当前账户没有修改权限。',
  );
  await capture(page, '09-viewer-write-denied');
  const s = await (await page.request.get('/api/v1/admin/auth/session')).json(),
    headers = { origin, 'x-csrf-token': s.csrfToken };
  const before = await (
    await page.request.get('/api/v1/admin/personas/' + fixture.personaId)
  ).json();
  for (const suffix of ['publish', 'unpublish', 'archive'])
    expect(
      (
        await page.request.post('/api/v1/admin/personas/' + fixture.personaId + '/' + suffix, {
          headers,
          data: { expectedRevision: before.revision, expectedVersionId: before.draftVersionId },
        })
      ).status(),
    ).toBe(403);
  expect(
    (
      await page.request.put('/api/v1/admin/personas/' + fixture.personaId, {
        headers,
        data: { expectedRevision: before.revision, name: 'MUST NOT WRITE' },
      })
    ).status(),
  ).toBe(403);
  const after = await (
    await page.request.get('/api/v1/admin/personas/' + fixture.personaId)
  ).json();
  expect(after.revision).toBe(before.revision);
  expect(after.publishedVersionId).toBe(before.publishedVersionId);
  expect((await page.request.get('/api/v1/me/chats/' + fixture.chatId)).status()).toBe(401);
  await noOverflow(page);
});

test('05 owned API restart preserves authentication, database chat and favorites', async ({
  page,
}) => {
  await userLogin(page, fixture.user!);
  const prior = await (await page.request.get('/api/v1/auth/session')).json();
  const restart = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/local-preview.ts', 'restart-api'],
    { encoding: 'utf8', timeout: 60000 },
  );
  expect(restart.status, restart.stderr).toBe(0);
  const current = await (await page.request.get('/api/v1/auth/session')).json();
  expect(current.user.id).toBe(prior.user.id);
  await page.goto('/history/' + fixture.chatId);
  await expect(page.locator('.message.user')).toHaveCount(20);
  await page.goto('/favorites');
  await expect(page.getByRole('heading', { name: fixture.name!, exact: true })).toBeVisible();
  await capture(page, '10-after-api-restart');
});

test('06 user isolation, chat deletion, account deletion and retained local preview record', async ({
  page,
  browser,
}) => {
  const outsider = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  await observe(outsider);
  const other = await outsider.newPage();
  fixture.outsider = await register(other);
  expect((await other.request.get('/api/v1/me/chats/' + fixture.chatId)).status()).toBe(404);
  const os = await (await other.request.get('/api/v1/auth/session')).json(),
    headers = { origin, 'x-csrf-token': os.csrfToken };
  expect(
    (
      await other.request.delete('/api/v1/me/chats/' + fixture.chatId, { headers, data: {} })
    ).status(),
  ).toBe(404);
  expect(
    (
      await other.request.post('/api/v1/me/chats/' + fixture.chatId + '/messages', {
        headers,
        data: { clientMessageId: randomUUID(), content: 'MUST NOT WRITE' },
      })
    ).status(),
  ).toBe(404);
  await other.goto('/chat/' + fixture.slug);
  const removedAccountChat = await chatId(other);
  fixture.deletedUserId = os.user.id;
  fixture.deletedChatId = removedAccountChat;
  await turns(other, 1);
  await other.goto('/account');
  await other.getByRole('button', { name: '查看注销确认', exact: true }).click();
  await other.getByLabel('确认当前密码', { exact: true }).fill(fixture.outsider.password);
  permit('/api/v1/auth/session', 401);
  permit('/api/v1/auth/rengine', 401);
  await other.getByRole('button', { name: '确认注销账户并删除个人记录', exact: true }).click();
  await expect(other).toHaveURL(/\/login\?closed=1$/);
  expect((await other.request.get('/api/v1/auth/session')).status()).toBe(401);
  expect((await other.request.get('/api/v1/me/chats/' + removedAccountChat)).status()).toBe(401);
  await capture(other, '11-account-deleted');
  await userLogin(page, fixture.user!);
  await page.goto('/history/' + fixture.chatId);
  await expect(page.locator('.message.user')).toHaveCount(20);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '删除这段聊天', exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  expect((await page.request.get('/api/v1/me/chats/' + fixture.chatId)).status()).toBe(404);
  await capture(page, '12-chat-deleted');
  await page.goto('/chat/' + fixture.slug);
  fixture.retainedId = await chatId(page);
  await turns(page, 3);
  await page.reload();
  await expect(page.locator('.message.user')).toHaveCount(3);
  await save();
  await outsider.close();
});

test('07 mobile and desktop layout, health, disabled integrations and zero browser runtime errors', async ({
  page,
}) => {
  await userLogin(page, fixture.user!);
  for (const width of [320, 375, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      '/',
      '/explore',
      '/account',
      '/favorites',
      '/history',
      '/history/' + fixture.retainedId,
    ]) {
      await page.goto(path);
      await noOverflow(page);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await capture(page, '13-home-desktop');
  await page.goto('/history/' + fixture.retainedId);
  await expect(page.locator('.message.user')).toHaveCount(3);
  await capture(page, '14-chat-desktop');
  const health = await (await page.request.get('/api/v1/health')).json();
  expect(health).toMatchObject({
    status: 'ok',
    mode: 'database',
    database: 'connected',
    ai: 'not-connected',
  });
  expect((await (await page.request.get('/api/v1/auth/rengine')).json()).enabled).toBe(false);
});
