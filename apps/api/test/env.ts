import fs from "fs";
import path from "path";
import { config, parse } from "dotenv";

/**
 * Resolve the test database URL from the repo-root .env.
 *
 * Imported by both vitest.config.ts (to set DATABASE_URL for the workers) and
 * the global setup (to migrate), so the two can never disagree about which
 * database the suite points at.
 *
 * Note this module is evaluated in two different environments: once in the
 * Vitest config process, where DATABASE_URL still holds the dev value, and
 * again inside each worker, where Vitest has already overwritten it with the
 * test value. So the dev URL is read from the FILE rather than from
 * process.env — otherwise both constants collapse to whatever is currently set.
 */

const ENV_PATH = path.resolve(__dirname, "../../../.env");

// Side effect: load JWT_SECRET and friends for code under test.
config({ path: ENV_PATH });

const fileUrl = fs.existsSync(ENV_PATH)
  ? parse(fs.readFileSync(ENV_PATH)).DATABASE_URL
  : undefined;

const devUrl = fileUrl ?? process.env.DATABASE_URL;

if (!devUrl) {
  throw new Error(
    "DATABASE_URL is not set. The test suite reads it from the repo-root .env — " +
      "run `cp .env.example .env` first (see AGENTS.md, quirk 2)."
  );
}

/** The dev database, e.g. .../turnapp — never written to by tests. */
export const DEV_DATABASE_URL = devUrl;

/** A sibling database, e.g. .../turnapp_test. Created on first run. */
export const TEST_DATABASE_URL = (() => {
  const url = new URL(devUrl);
  url.pathname = `/${url.pathname.replace(/^\//, "")}_test`;
  return url.toString();
})();
