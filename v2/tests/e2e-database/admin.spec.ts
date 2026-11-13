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
