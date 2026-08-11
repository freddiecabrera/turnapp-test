import path from "path";
import { execSync } from "child_process";
import { TEST_DATABASE_URL } from "./env";

/**
 * Bring the test database up to schema before the suite runs.
 *
 * `migrate reset` rather than `migrate deploy`. AGENTS.md instructs hand-editing
 * generated migration SQL — the trades migration appends a partial unique index
 * and two CHECK constraints below the generated block — and `deploy` keys off a
 * migration's *name*, not its content. So after any such edit `deploy` considers
 * the migration already applied and does nothing: the test database silently
 * keeps a stale schema, and a test asserting the constraint fails looking like a
 * code bug. `reset` drops and re-applies every migration from scratch on every
 * run, so the schema always matches the files on disk.
 *
 * That is affordable precisely because this database is a throwaway: the suite
 * truncates between cases anyway, so there is no state worth preserving.
 *
 * `--force` skips the interactive confirmation; `--skip-seed` stops it running
 * the dev seed, which package.json declares under `prisma.seed`.
 */
export default function setup() {
  // The child process is handed TEST_DATABASE_URL and nothing else, but assert
  // it anyway — this command drops a database, and the cost of being wrong is
  // someone's seeded dev data.
  if (!/_test(\?|$)/.test(TEST_DATABASE_URL)) {
    throw new Error(
      `Refusing to reset a database that is not the test one: ${TEST_DATABASE_URL}`
    );
  }

  try {
    execSync("npx prisma migrate reset --force --skip-seed", {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: "pipe",
    });
  } catch (err) {
    // execSync's own message is just the command line; the actionable part
    // (Postgres not up, client not generated) is in the captured output.
    const { stdout, stderr } = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `prisma migrate reset failed for the test database.\n${stderr ?? ""}${stdout ?? ""}`
    );
  }
}
