import crypto from "crypto";
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

/**
 * The checkout this file belongs to, resolved through symlinks.
 *
 * `realpathSync` rather than the raw path: a worktree reached through a
 * symlink would otherwise hash to a second name for the same checkout, and the
 * two would then race each other exactly the way this tag exists to prevent.
 *
 * Derived from `__dirname` rather than `git rev-parse --show-toplevel`. Same
 * answer, and this module is imported by the Vitest config process, the global
 * setup and every worker — a subprocess in each of those is a cost paid on
 * every run for a value that cannot change, and it would make the suite need
 * git on PATH to name a database.
 */
const CHECKOUT_ROOT = fs.realpathSync(path.resolve(__dirname, "../../.."));

/**
 * A short, stable fingerprint of this checkout.
 *
 * Stable is the requirement, not unpredictable: `migrate reset` in the global
 * setup drops and rebuilds whatever this names, so a value that moved between
 * runs — a timestamp, a pid, anything random — would leave a new abandoned
 * database on the container every time the suite ran. A hash of the path is
 * the same on every run from this worktree and different from every other.
 *
 * SHA-1 because this is a naming device, not a security boundary; eight hex
 * digits because the collision risk across the handful of worktrees one machine
 * holds is negligible and the name has to stay inside Postgres's 63-byte limit.
 */
const CHECKOUT_TAG = crypto.createHash("sha1").update(CHECKOUT_ROOT).digest("hex").slice(0, 8);

/**
 * This worktree's own test database, e.g. .../turnapp_test_1a2b3c4d.
 *
 * Created on first run, and **per checkout on purpose**. The global setup runs
 * `prisma migrate reset` against this name, which drops the schema; with one
 * fixed `turnapp_test` shared by every worktree, a suite running in one
 * checkout drops the tables out from under a suite running in another, and the
 * victim fails with things like `The table public.Season does not exist` —
 * a failure that looks like a code bug and belongs to a different process
 * entirely. Naming the database after the checkout makes concurrent runs
 * independent rather than merely unlikely to collide.
 *
 * The `_test_<tag>` shape matters: `global-setup.ts` refuses to reset anything
 * that does not match it, and that guard is what stands between a typo here and
 * someone's seeded dev data.
 */
export const TEST_DATABASE_URL = (() => {
  const url = new URL(devUrl);
  const name = `${url.pathname.replace(/^\//, "")}_test_${CHECKOUT_TAG}`;

  // Postgres truncates identifiers at 63 bytes, and truncation is how two
  // distinct checkouts would silently end up sharing one database again —
  // reintroducing the exact failure this tag removes, with no error to read.
  if (Buffer.byteLength(name) > 63) {
    throw new Error(
      `Derived test database name "${name}" exceeds Postgres's 63-byte identifier limit. ` +
        `Shorten POSTGRES_DB / the DATABASE_URL database name in .env.`
    );
  }

  url.pathname = `/${name}`;
  return url.toString();
})();
