import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'coverage/'],
    },
  },
  resolve: {
    alias: {
      '@smugit/shared': new URL('./packages/shared/src', import.meta.url).pathname,
      '@smugit/cli': new URL('./packages/cli/src', import.meta.url).pathname,
      '@smugit/api': new URL('./packages/api/src', import.meta.url).pathname,
    },
  },
});