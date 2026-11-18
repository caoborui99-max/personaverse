import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e-database',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4310',
    launchOptions: process.env.PV_CHROMIUM_PATH
      ? { executablePath: process.env.PV_CHROMIUM_PATH }
      : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @pv/api start',
      url: 'http://127.0.0.1:4311/api/v1/health',
      reuseExistingServer: false,
      env: { PV_MODE: 'database' },
    },
    {
      command: 'pnpm --filter @pv/web start',
      url: 'http://127.0.0.1:4310',
      reuseExistingServer: false,
    },
  ],
});
