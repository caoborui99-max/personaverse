import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e-runtime',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120000,
  outputDir: 'playwright-report/runtime-artifacts',
  reporter: [['list'], ['json', { outputFile: 'playwright-report/runtime-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4310',
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.PV_CHROMIUM_PATH
      ? { executablePath: process.env.PV_CHROMIUM_PATH }
      : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
