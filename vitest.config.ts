import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/stubs/empty.ts") } },
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 120000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/uclfantasy_test",
      DATABASE_URL_UNPOOLED: process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/uclfantasy_test",
    },
  },
});
