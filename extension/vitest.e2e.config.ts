import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000, // E2E tests need longer timeout
    include: ['e2e/**/*.test.ts'],
    // Run E2E tests sequentially
    fileParallelism: false,
  },
})
