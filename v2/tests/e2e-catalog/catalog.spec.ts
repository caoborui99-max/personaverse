import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:4311/__test/mode?value=offline');
});
test('home stays readable during an SSR API outage and retry loads recovered personas', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  expect((await page.goto('/'))?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: '人格列表暂时无法加载' })).toBeVisible();
  await expect(page.getByRole('link', { name: '先看预置演示' })).toBeVisible();
  await expect(page.getByText('站长尚未发布人格，敬请期待。')).toHaveCount(0);
  await request.post('http://127.0.0.1:4311/__test/mode?value=healthy');
  await page.getByRole('link', { name: '重新加载' }).click();
  await expect(page.getByText('TEST ONLY 人格', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('explore shows an explicit outage and does not claim there are no matching personas', async ({
  page,
}) => {
  expect((await page.goto('/explore'))?.status()).toBe(200);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('人格列表暂时无法加载');
  await expect(page.getByRole('heading', { name: '暂时没有匹配结果' })).toHaveCount(0);
});
test('category outage does not hide successfully loaded personas', async ({ page, request }) => {
  await request.post('http://127.0.0.1:4311/__test/mode?value=categories-offline');
  expect((await page.goto('/explore'))?.status()).toBe(200);
  await expect(page.getByRole('status')).toContainText('分类暂时不可用');
  await expect(page.getByText('TEST ONLY 人格', { exact: true })).toBeVisible();
});
test('successful empty catalogue stays distinct from an outage', async ({ page, request }) => {
  await request.post('http://127.0.0.1:4311/__test/mode?value=empty');
  expect((await page.goto('/'))?.status()).toBe(200);
  await expect(page.getByText('站长尚未发布人格，敬请期待。')).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});
