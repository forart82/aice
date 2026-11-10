import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["poc_real_case/**", "node_modules/**"],
    testTimeout: 60000,
    hookTimeout: 60000,
    maxWorkers: 2,
  },
});
