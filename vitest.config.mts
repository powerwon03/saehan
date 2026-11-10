import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup/env.ts'], testTimeout: 30000, hookTimeout: 30000 },
});
