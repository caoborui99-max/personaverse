import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';
process.env.PV_TEST_ADMIN_PASSWORD ||= randomBytes(24).toString('hex');
export default defineConfig({
  testDir: './tests/browser', timeout: 45000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 390, height: 844 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/dev-server.js', url: 'http://127.0.0.1:4173/api/session', reuseExistingServer: false,
    env: { ...process.env, PORT: '4173', SQLITE_PATH: '.local/browser.sqlite', NODE_ENV: 'test', ADMIN_EMAIL: 'admin@example.test', ADMIN_PASSWORD: process.env.PV_TEST_ADMIN_PASSWORD, ALLOW_REGISTRATION: 'true' } },
  reporter: [['list'], ['html', { open: 'never' }]]
});
