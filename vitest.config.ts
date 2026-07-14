import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "server/src/**/*.test.ts",
      "apps/desktop/src/**/*.test.ts",
      "apps/operator/src/**/*.test.ts",
    ],
    environment: "node",
    passWithNoTests: false,
  },
});
