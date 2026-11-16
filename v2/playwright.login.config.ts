import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e-login',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90000,
  outputDir: 'playwright-report/login-artifacts',
  reporter: [['list'], ['json', { outputFile: 'playwright-report/login-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4310',
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.PV_CHROMIUM_PATH
      ? { executablePath: process.env.PV_CHROMIUM_PATH }
      : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @pv/api start',
      env: { PV_MODE: 'database', PV_LOCAL_MAIL: '1', PV_RENGINE_MOCK: '0' },
      url: 'http://127.0.0.1:4311/api/v1/health',
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @pv/web start',
      url: 'http://127.0.0.1:4310',
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
