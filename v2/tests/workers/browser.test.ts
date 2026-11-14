import { beforeAll, afterAll, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { workersHarness } from './harness.ts';
let h: Awaited<ReturnType<typeof workersHarness>>;
beforeAll(async () => {
  h = await workersHarness();
}, 120000);
afterAll(async () => {
  await h?.close();
});
it('original five browser security/lifecycle tests pass against Workers in a fresh isolated fixture', () => {
  const result = spawnSync(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.workers.config.ts'],
    {
      env: { ...process.env, TEST_ADMIN_EMAIL: h.email, TEST_ADMIN_PASSWORD: h.password },
      stdio: 'inherit',
      timeout: 120000,
    },
  );
  expect(result.status).toBe(0);
}, 150000);
