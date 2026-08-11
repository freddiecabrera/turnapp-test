import path from "path";
import { execSync } from "child_process";
import { TEST_DATABASE_URL } from "./env";

/**
 * Bring the test database up to schema before the suite runs.
 *
 * `prisma migrate deploy` creates the database if it does not exist and applies
 * committed migrations without prompting or diffing, which is exactly what a
 * non-interactive bootstrap wants — and it means no extra Postgres driver
 * dependency just to issue a CREATE DATABASE.
 *
 * Prerequisite is only `npm run db:up`.
 */
export default function setup() {
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
