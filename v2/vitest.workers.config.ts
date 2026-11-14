import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/workers/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
