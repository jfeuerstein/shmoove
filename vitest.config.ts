import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/sim/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 30_000,
  },
});
