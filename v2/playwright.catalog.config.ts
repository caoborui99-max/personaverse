import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e-catalog',
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4310',
    launchOptions: process.env.PV_CHROMIUM_PATH
      ? { executablePath: process.env.PV_CHROMIUM_PATH }
      : {},
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/catalog-failure-fixture.mjs',
      url: 'http://127.0.0.1:4311/ready',
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @pv/web start',
      url: 'http://127.0.0.1:4310',
      reuseExistingServer: false,
      env: { API_INTERNAL_URL: 'http://127.0.0.1:4311', PV_WORKERS_ADAPTER: '' },
      timeout: 60000,
    },
  ],
});
