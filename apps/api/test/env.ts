import fs from "fs";
import path from "path";
import { parse } from "dotenv";

/**
 * Resolve the dev and test database URLs from the repo-root .env file.
 *
 * This module is evaluated in three environments: the Vitest config process
 * (where DATABASE_URL still holds the dev value), the global setup (same), and
 * each worker (where Vitest has already overwritten it with the test value).
 * Both constants are therefore read from the FILE and never from process.env —
 * consulting process.env inside a worker would make DEV_DATABASE_URL name the
 * *test* database, collapsing the distinction the two constants exist to draw.
 *
 * For the same reason the file is the sole source of truth, with no process.env
 * fallback: a fallback only ever fires in the situation it would get wrong.
 */

const ENV_PATH = path.resolve(__dirname, "../../../.env");

const REMEDY =
  "The test suite reads DATABASE_URL from the repo-root .env — " +
  "run `cp .env.example .env` first (see AGENTS.md, quirk 2).";

if (!fs.existsSync(ENV_PATH)) {
  throw new Error(`No .env file at ${ENV_PATH}. ${REMEDY}`);
}

const devUrl = parse(fs.readFileSync(ENV_PATH)).DATABASE_URL;

if (!devUrl) {
  throw new Error(`${ENV_PATH} does not define DATABASE_URL. ${REMEDY}`);
}

/** The dev database, e.g. .../turnapp — never written to by tests. */
export const DEV_DATABASE_URL = devUrl;

/** A sibling database, e.g. .../turnapp_test. Created on first run. */
export const TEST_DATABASE_URL = (() => {
  const url = new URL(devUrl);
  url.pathname = `/${url.pathname.replace(/^\//, "")}_test`;
  return url.toString();
})();
