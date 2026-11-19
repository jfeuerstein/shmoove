import { defineConfig } from 'vitest/config';

/** The full balance harness: `npm run balance`. Not part of `npm test` or the gate. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/balance/**/*.test.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    // One process, one file: the runs are played in sequence.
    fileParallelism: false,
    // The tables are the output.
    silent: false,
  },
});
