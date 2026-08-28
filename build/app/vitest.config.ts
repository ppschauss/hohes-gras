import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    environment: 'node',
    // Each integration test opens its own SQLite file; running the files
    // sequentially keeps the temp-dir churn predictable and the output readable.
    fileParallelism: false,
  },
})
