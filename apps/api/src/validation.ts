/**
 * Input checks that belong at the edge of a route, shared by the routers that
 * need them.
 *
 * Validation in this codebase is hand-rolled and inline — no zod, no schema
 * layer (AGENTS.md, "Conventions"). What lives here is the narrow exception:
 * a rule that is not about one endpoint's fields but about what a string may
 * contain at all, and that therefore has to hold identically on every route or
 * it holds on none of them.
 */

/**
 * Postgres rejects a null byte inside a `text` value outright — `22021 invalid
 * byte sequence for encoding "UTF8": 0x00` — so a string carrying one cannot be
 * queried with, only refused.
 *
 * The async boundary in `./async-router` already stops that rejection from
 * killing the process, but a 500 is the wrong answer to input we can classify
 * before touching the database. Refuse it at the edge and the 500 stays what it
 * should be: a bug we didn't anticipate.
 *
 * Note `.trim()` is not this check. Trimming removes whitespace, and `\0` is
 * not whitespace to `String.prototype.trim` — a trimmed id can still carry one,
 * which is exactly how this reached Postgres from `POST /trades` after every
 * field had been normalised.
 *
 * It lives here rather than in either router because both need it and the rule
 * is the same rule: `routes/users.ts` had it first, `routes/trades.ts` was
 * written next and didn't, and three endpoints answered 500 to input the two
 * next to them answered 400 to. A copy per router is a rule that drifts one
 * router at a time.
 */
export function hasNullByte(value: string): boolean {
  return value.includes("\0");
}
