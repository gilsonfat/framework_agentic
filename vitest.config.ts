import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests here scaffold real projects, run git and spawn processes.
    // The default 5s trips under parallel load even when nothing is wrong.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
