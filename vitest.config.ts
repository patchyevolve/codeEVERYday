import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"],
    // Integration tests read and write a real database. They are excluded from
    // the default run and executed separately by `npm run test:integration`
    // against TEST_DATABASE_URL, so a plain `npm test` can never mutate the
    // development database.
    exclude: [...configDefaults.exclude, "apps/api/tests/integration/**"],
    pool: "forks",
    testTimeout: 10_000,
  },
});
