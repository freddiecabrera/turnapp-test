import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./test/env";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],

    // Every test file shares one database and truncates between cases, so they
    // must not overlap. Running files sequentially is simpler and more honest
    // than trying to isolate concurrent writers against shared tables.
    fileParallelism: false,

    // Point the workers at the test database, never the dev one.
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
    },
  },
});
