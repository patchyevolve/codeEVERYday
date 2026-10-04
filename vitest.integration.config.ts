import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Integration tests: exercise the Fastify app against a real PostgreSQL
 * database (TEST_DATABASE_URL — see apps/api/tests/integration/helpers.ts).
 *
 * Run with: npm run test:integration
 *
 * `fileParallelism` is off because the tests share one database and each file
 * cleans up after itself; running files concurrently would race on cleanup.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ["apps/api/tests/integration/**/*.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
