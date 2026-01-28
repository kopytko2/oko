import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    // Run test files sequentially to avoid port conflicts
    fileParallelism: false,
    // Isolate each test file
    isolate: true,
  },
})
