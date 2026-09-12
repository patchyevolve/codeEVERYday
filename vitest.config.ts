import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"],
    pool: "forks",
    testTimeout: 10_000,
  },
});
