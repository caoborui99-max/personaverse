import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
async function login(page: import('@playwright/test').Page) {
  await page.goto('/admin/login');
  await page.getByLabel('管理员邮箱').fill(process.env.TEST_ADMIN_EMAIL!);
  await page.getByLabel('密码', { exact: true }).fill(process.env.TEST_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
test('real login, owner content lifecycle, exact versions, publication, recovery and logout on mobile', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/personas');
  await expect(page).toHaveURL(/admin\/login/);
  await page.getByLabel('管理员邮箱').fill(process.env.TEST_ADMIN_EMAIL!);
  await page.getByLabel('密码', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('form [role=alert]')).toContainText('邮箱或密码不正确');
  await login(page);
  await page.getByRole('link', { name: '管理人格 ↗', exact: true }).click();
  await page.getByRole('link', { name: '新建草稿 ＋' }).click();
  await page.getByRole('button', { name: '创建空白草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);
  const editor = page.url();
  await expect(page.getByLabel('人格名称', { exact: true })).toHaveValue('');
  await page.getByText('新增分类', { exact: true }).click();
  await page.getByLabel('分类名称', { exact: true }).fill('手工测试分类');
  await page.getByLabel('分类 slug', { exact: true }).fill('manual-' + randomUUID());
  await page.getByRole('button', { name: '创建分类', exact: true }).click();
  await expect(page.getByText('分类已创建。')).toBeVisible();
  await page.getByLabel('人格名称', { exact: true }).fill('手工验收人格');
  const slug = 'manual-' + randomUUID();
  await page.getByLabel('页面标识 slug', { exact: true }).fill(slug);
  await page.getByLabel('简介', { exact: true }).fill('仅用于隔离 PostgreSQL 验收');
  await page.getByLabel('背景故事', { exact: true }).fill('手动填写的测试背景，不是正式人格内容。');
  await page.getByLabel('手工测试分类', { exact: true }).check();
  const core = '  测试内核原文\n保留换行与空格  ';
  await page.getByLabel('完整人格内核 · 原文保存', { exact: true }).fill(core);
  await page.getByLabel('开场白', { exact: true }).fill('手动测试开场白');
  await expect(page.getByText('未保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存草稿并创建版本' }).click();
  await expect(page.getByText('草稿已保存，并创建不可变的新版本。')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('完整人格内核 · 原文保存')).toHaveValue(core);
  await page.screenshot({ path: 'test-results/admin-editor-mobile.png', fullPage: true });
  const publicContext = await browser.newContext();
  const guest = await publicContext.newPage();
  expect((await guest.goto('/persona/' + slug))?.status()).toBe(404);
  await page.getByRole('button', { name: '发布当前草稿', exact: true }).click();
  await expect(page.getByText('当前草稿版本已发布。')).toBeVisible();
  expect((await guest.goto('/persona/' + slug))?.status()).toBe(200);
  await expect(guest.getByRole('heading', { name: '手工验收人格', exact: true })).toBeVisible();
  await guest.goto('/explore');
  await guest.getByRole('textbox', { name: '搜索人格' }).fill('手工验收');
  await expect(guest.getByRole('heading', { name: '手工验收人格', exact: true })).toBeVisible();
  await guest.getByRole('button', { name: '收藏' + slug, exact: true }).click();
  await guest.goto('/favorites');
  await expect(guest.getByRole('heading', { name: '手工验收人格', exact: true })).toBeVisible();
  await page.getByLabel('完整人格内核 · 原文保存').fill('第二版本的手写测试原文');
  await page.getByRole('button', { name: '保存草稿并创建版本' }).click();
  await expect(page.getByText('草稿已保存，并创建不可变的新版本。')).toBeVisible();
  await page.getByRole('link', { name: '版本历史 ↗' }).click();
  await page.getByRole('button', { name: '比较版本', exact: true }).click();
  await expect(page.getByRole('heading', { name: '差异比较' })).toBeVisible();
  await page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: /^v1 / }) })
    .locator('summary')
    .click();
  await page.getByRole('button', { name: '恢复 v1 为新草稿' }).click();
  await expect(page.getByText('已恢复为新草稿版本，旧版本保持不变。')).toBeVisible();
  await page.goto(editor);
  await expect(page.getByLabel('完整人格内核 · 原文保存')).toHaveValue(core);
  await page.getByRole('link', { name: '管理员版本测试 ↗' }).click();
  await page.getByRole('button', { name: '建立版本测试会话' }).click();
  await expect(page.getByText(/固定版本：/)).toBeVisible();
  await page.getByLabel('测试消息', { exact: true }).fill('预览测试');
  await page.getByRole('button', { name: '发送模拟测试' }).click();
  await expect(page.locator('.message.assistant')).toContainText('模拟回复');
  await page.goto(editor);
  await page.getByRole('button', { name: '下架人格', exact: true }).click();
  await expect(page.getByText('已下架，公开入口已关闭。')).toBeVisible();
  expect((await guest.goto('/persona/' + slug))?.status()).toBe(404);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/admin\/login/);
  expect((await page.request.get('/api/v1/admin/personas')).status()).toBe(401);
  await publicContext.close();
});
test('stale editor cannot silently overwrite and draft test never publishes automatically', async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto('/admin/personas/new');
  await page.getByRole('button', { name: '创建空白草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);
  const url = page.url();
  const second = await context.newPage();
  await second.goto(url);
  await expect(second.getByLabel('人格名称', { exact: true })).toBeVisible();
  await page.getByLabel('人格名称', { exact: true }).fill('先保存的内容');
  await page.getByRole('button', { name: '保存草稿并创建版本' }).click();
  await expect(page.getByText('草稿已保存，并创建不可变的新版本。')).toBeVisible();
  await second.getByLabel('人格名称', { exact: true }).fill('后保存不得覆盖');
  await second.getByRole('button', { name: '保存草稿并创建版本' }).click();
  await expect(second.locator('.admin-error')).toContainText('其他页面修改');
  await expect(second.getByLabel('人格名称', { exact: true })).toHaveValue('后保存不得覆盖');
  await page.reload();
  await expect(page.getByLabel('人格名称', { exact: true })).toHaveValue('先保存的内容');
  await second.close();
});

async function preparedEditor(page: import('@playwright/test').Page) {
  await login(page);
  const session = await (await page.request.get('/api/v1/admin/auth/session')).json();
  const headers = { origin: 'http://127.0.0.1:4310', 'x-csrf-token': session.csrfToken };
  const categoryResponse = await page.request.post('/api/v1/admin/categories', {
    headers,
    data: { name: 'TEST ONLY 分类 ' + randomUUID(), slug: 'test-' + randomUUID() },
  });
  expect(categoryResponse.status()).toBe(200);
  const category = await categoryResponse.json();
  const create = await page.request.post('/api/v1/admin/personas', { headers, data: {} });
  expect(create.status()).toBe(201);
  const persona = await create.json();
  const source = '  TEST ONLY 手写内核\n原文与空格保持不变  ';
  const save = await page.request.put('/api/v1/admin/personas/' + persona.id, {
    headers,
    data: {
      name: 'TEST ONLY 发布保护',
      slug: persona.slug,
      summary: 'TEST ONLY 手动测试资料',
      background: 'TEST ONLY 手动测试背景',
      avatarUrl: '',
      tags: [],
      categoryIds: [category.id],
      coreText: source,
      openingMessage: 'TEST ONLY 手写开场白',
      expectedRevision: 0,
    },
  });
  expect(save.status()).toBe(200);
  await page.goto(`/admin/personas/${persona.id}/edit`);
  await expect(page.getByLabel('完整人格内核 · 原文保存')).toHaveValue(source);
  return { id: persona.id, headers, source };
}

test('dirty mobile editor blocks publication and preserves original input during slow save', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { id, source } = await preparedEditor(page);
  const publish = page.getByRole('button', { name: '发布当前草稿', exact: true });
  await expect(page.getByText(/即将发布：草稿版本 v1/)).toBeVisible();
  const edited = source + '\n  TEST ONLY 第二版原文  ';
  const core = page.getByLabel('完整人格内核 · 原文保存');
  await core.fill(edited);
  await expect(publish).toBeDisabled();
  await expect(page.getByText(/有未保存修改，请先保存后再发布/)).toBeVisible();
  const before = await (await page.request.get(`/api/v1/admin/personas/${id}`)).json();
  expect(before.publishedVersionId).toBeNull();
  expect(before.status).toBe('draft');

  let saves = 0;
  let releaseSave!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route(`**/api/v1/admin/personas/${id}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    saves++;
    await release;
    await route.continue();
  });
  await page.getByRole('button', { name: '保存草稿并创建版本' }).click();
  await expect(core).toBeDisabled();
  await expect(publish).toBeDisabled();
  await expect(page.getByText('请求处理中，请等待完成', { exact: true })).toBeVisible();
  // A second submit in the same pending operation must never append another version.
  await page.locator('form.admin-form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(core).toHaveValue(edited);
  releaseSave();
  await expect(page.getByText('草稿已保存，并创建不可变的新版本。')).toBeVisible();
  expect(saves).toBe(1);
  await expect(core).toBeEnabled();
  await expect(core).toHaveValue(edited);
  await expect(page.getByText(/即将发布：草稿版本 v2/)).toBeVisible();
  await page.reload();
  await expect(core).toHaveValue(edited);
  const versions = await (await page.request.get(`/api/v1/admin/personas/${id}/versions`)).json();
  expect(versions.items).toHaveLength(2);
  expect(versions.items[1].coreText).toBe(source);
});

test('publication names the displayed version and serializes repeated publish clicks', async ({
  page,
}) => {
  const { id, source } = await preparedEditor(page);
  const saved = await (await page.request.get(`/api/v1/admin/personas/${id}`)).json();
  await expect(page.getByText(/即将发布：草稿版本 v1/)).toBeVisible();
  let publications = 0;
  let postedVersion: string | undefined;
  let releasePublish!: () => void;
  const release = new Promise<void>((resolve) => {
    releasePublish = resolve;
  });
  await page.route(`**/api/v1/admin/personas/${id}/publish`, async (route) => {
    publications++;
    postedVersion = route.request().postDataJSON().expectedVersionId;
    await release;
    await route.continue();
  });
  const publish = page.getByRole('button', { name: '发布当前草稿', exact: true });
  await publish.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(publish).toBeDisabled();
  await expect(page.getByLabel('完整人格内核 · 原文保存')).toBeDisabled();
  releasePublish();
  await expect(page.getByText('当前草稿版本已发布。')).toBeVisible();
  expect(publications).toBe(1);
  expect(postedVersion).toBe(saved.draftVersionId);
  const persisted = await (await page.request.get(`/api/v1/admin/personas/${id}`)).json();
  expect(persisted.publishedVersionId).toBe(saved.draftVersionId);
  expect(persisted.draftVersion.coreText).toBe(source);
});

test('Strict cookie rejects the first cross-site top-level GET without revoking the session', async ({
  page,
  context,
}) => {
  await login(page);
  const adminCookie = (await context.cookies()).find(
    (cookie) => cookie.name === 'pv_v2_admin_local',
  );
  expect(adminCookie?.sameSite).toBe('Strict');
  expect(adminCookie?.httpOnly).toBe(true);
  const origin = 'http://127.0.0.1:4310';
  const sessionUrl = origin + '/api/v1/admin/auth/session';
  // This synthetic origin is fulfilled locally. No attacker host or external service is contacted.
  await page.route('http://attacker.invalid/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<a href="${sessionUrl}">跨站访问会话</a>`,
    }),
  );
  await page.goto('http://attacker.invalid/');
  const [crossSiteResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.url() === sessionUrl && response.request().isNavigationRequest(),
    ),
    page.getByRole('link', { name: '跨站访问会话', exact: true }).click(),
  ]);
  expect(crossSiteResponse.status()).toBe(401);
  const sentHeaders = await crossSiteResponse.request().allHeaders();
  expect(/(?:^|;\s*)pv_v2_admin_local=/.test(sentHeaders.cookie ?? '')).toBe(false);
  await expect(page).toHaveURL(sessionUrl);
  await page.waitForLoadState('load');

  // Once on the site's origin, a deliberate same-site navigation carries the existing cookie.
  // The cross-site 401 must not be confused with logout, expiry, or a missing database session.
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/admin';
    link.textContent = '进入站内管理';
    document.body.append(link);
  });
  await page.getByRole('link', { name: '进入站内管理', exact: true }).click();
  await expect(page).toHaveURL(origin + '/admin');
  await expect(page.getByRole('heading', { name: '站长工作空间', exact: true })).toBeVisible();
  expect((await page.reload())?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: '站长工作空间', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/admin\/login/);
  expect((await page.request.get('/api/v1/admin/auth/session')).status()).toBe(401);
});
