import { expect, test } from '@playwright/test';
test('public routes, SSR content, search, favorites and admin barrier', async ({
  page,
  request,
}) => {
  const html = await (await request.get('/persona/test-a')).text();
  expect(html).toContain('测试人格 A');
  for (const path of ['/', '/explore', '/persona/test-a', '/favorites', '/admin/login']) {
    expect((await page.goto(path))?.status()).toBe(200);
    await expect(page.locator('main')).toBeVisible();
  }
  await page.goto('/explore');
  await page.getByRole('textbox', { name: '搜索人格' }).fill('不存在');
  await expect(page.getByText('暂时没有匹配结果')).toBeVisible();
  await page.getByRole('button', { name: '重置筛选' }).click();
  await page.getByRole('button', { name: '收藏test-a', exact: true }).click();
  await page.goto('/favorites');
  await expect(page.getByRole('heading', { name: '测试人格 A' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '测试人格 A' })).toBeVisible();
  await page.goto('/admin');
  await expect(page).toHaveURL(/admin\/login/);
  await expect(page.getByRole('button', { name: '登录服务尚未实现' })).toBeDisabled();
  expect((await request.get('/api/v1/admin/personas')).status()).toBe(401);
  expect(
    (
      await request.post('/api/v1/admin/auth/login', {
        headers: { origin: 'http://127.0.0.1:4310' },
        data: {},
      })
    ).status(),
  ).toBe(503);
  expect((await page.goto('/persona/unknown'))?.status()).toBe(404);
});
test('20 rounds, stable id, reload, retry, switch and clear', async ({ page }) => {
  await page.goto('/chat/test-a');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await expect(input).toBeEnabled();
  const id = await page.getByTestId('session-id').innerText();
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  for (let i = 1; i <= 20; i++) {
    await input.fill(`连续消息 ${i}`);
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.locator('.message.assistant')).toHaveCount(i);
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('');
  }
  await page.reload();
  await expect(input).toBeEnabled();
  await expect(page.locator('.message.assistant')).toHaveCount(20);
  await expect(page.getByTestId('session-id')).toHaveText(id);
  await input.fill('/fail-once');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.chat-error[role=alert]')).toContainText('模拟请求失败');
  await page.reload();
  await expect(page.getByRole('button', { name: '重试消息' })).toBeEnabled();
  await page.getByRole('button', { name: '重试消息' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(21);
  await expect(input).toBeEnabled();
  await input.fill('失败后继续');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(22);
  await page.locator('.chat-sidebar a[href="/chat/test-b"]').click();
  await expect(page.getByRole('heading', { name: '测试人格 B', exact: true })).toBeVisible();
  await expect(input).toBeEnabled();
  expect(await page.getByTestId('session-id').innerText()).not.toBe(id);
  await expect(page.locator('.message')).toHaveCount(0);
  await page.locator('.chat-sidebar a[href="/chat/test-a"]').click();
  await expect(page.locator('.message.assistant')).toHaveCount(22);
  await page.getByRole('button', { name: '清除全部聊天' }).click();
  await expect(page.locator('.message')).toHaveCount(0);
  await expect(input).toBeEnabled();
  await page.reload();
  await expect(input).toBeEnabled();
  await expect(page.locator('.message')).toHaveCount(0);
});
test('network failure releases UI for retry without duplicate messages', async ({ page }) => {
  await page.goto('/chat/test-a');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await expect(input).toBeEnabled();
  await page.route('**/chat/sessions/*/messages', (route) =>
    route.request().method() === 'POST' ? route.abort() : route.continue(),
  );
  await input.fill('网络恢复测试');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByRole('button', { name: '重试消息' })).toBeEnabled();
  await page.unroute('**/chat/sessions/*/messages');
  await page.getByRole('button', { name: '重试消息' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await expect(input).toBeEnabled();
});
test('damaged and disabled device storage degrades safely', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('pv:v2:chat:test-a', '{broken');
    localStorage.setItem('pv:v2:favorites', 'null');
  });
  await page.goto('/chat/test-a');
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeEnabled();
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'setItem', {
      value: () => {
        throw new Error('disabled');
      },
    });
  });
  await page.goto('/chat/test-b');
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeEnabled();
  await expect(page.getByRole('status')).toContainText('设备存储不可用');
});
for (const width of [320, 375, 390, 768, 1440])
  test(`layout has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const path of [
      '/',
      '/explore',
      '/persona/test-a',
      '/chat/test-a',
      '/favorites',
      '/admin/login',
    ]) {
      await page.goto(path);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        path,
      ).toBe(true);
      if (path === '/' && [390, 1440].includes(width))
        await page.screenshot({ path: `test-results/preview-${width}.png`, fullPage: true });
      if (path === '/chat/test-a' && width === 390)
        await page.screenshot({ path: 'test-results/preview-chat.png' });
    }
  });

test('expired visitor can reconnect with the unsent input preserved', async ({ page, context }) => {
  await page.goto('/chat/test-a');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await expect(input).toBeEnabled();
  await context.clearCookies();
  await input.fill('需要保留的输入');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByRole('button', { name: '重新连接' })).toBeEnabled();
  await page.getByRole('button', { name: '重新连接' }).click();
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('需要保留的输入');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(1);
});

test('refresh reconciles a saved message whose response was lost', async ({ page }) => {
  await page.goto('/chat/test-a');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await expect(input).toBeEnabled();
  await page.route('**/chat/sessions/*/messages', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await input.fill('响应丢失但服务端已保存');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByRole('button', { name: '重试消息' })).toBeEnabled();
  await page.unroute('**/chat/sessions/*/messages');
  await page.reload();
  await expect(input).toBeEnabled();
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '重试消息' })).toHaveCount(0);
});
