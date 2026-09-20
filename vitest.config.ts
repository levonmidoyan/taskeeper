import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

process.env.TZ = 'UTC';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup/env.ts'],
    // Tests share one database and truncate between cases, so they must not run
    // in parallel against each other.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
