import { defineConfig } from 'vitest/config';

// `npm run test:pg`: the DB/API suites over postgres-js (the production driver) against a PGlite socket server.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/server/db.test.ts', 'tests/server/board-api.test.ts', 'tests/server/worker-api.test.ts'],
    setupFiles: ['tests/setup/env.ts'],
    globalSetup: ['tests/setup/pgServer.ts'],
    env: { TEST_DRIVER: 'postgres' },
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
