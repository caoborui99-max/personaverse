import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e-database',
  outputDir: 'playwright-report/workers-artifacts',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4320',
    launchOptions: process.env.PV_CHROMIUM_PATH
      ? { executablePath: process.env.PV_CHROMIUM_PATH }
      : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
