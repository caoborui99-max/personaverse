import { beforeAll, afterAll, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { workersHarness } from './harness.ts';
let h: Awaited<ReturnType<typeof workersHarness>>;
beforeAll(async () => {
  h = await workersHarness({ legacyAnonymousTestMode: false });
}, 120000);
afterAll(async () => {
  await h?.close();
});
it('mobile user registration, verification, private history and reset flows run through Workers', async () => {
  const status = await new Promise<number | null>((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [
        'node_modules/@playwright/test/cli.js',
        'test',
        '--config',
        'playwright.workers-users.config.ts',
      ],
      {
        env: {
          ...process.env,
          PV_TEST_MAIL_DIR: h.mailDirectory,
          TEST_ADMIN_EMAIL: h.email,
          TEST_ADMIN_PASSWORD: h.password,
        },
        stdio: 'inherit',
      },
    );
    p.once('error', reject);
    p.once('exit', resolve);
  });
  expect(status).toBe(0);
}, 240000);
