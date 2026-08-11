import type { OwnedCard, UserSummary } from "@turnapp/shared";
import { asyncRouter } from "../async-router";
import { prisma } from "../prisma";
import { requireAuth } from "../auth";
import { toPublicCard, toUserSummary } from "../serialize";

/**
 * Partner discovery: the two reads the create-trade flow needs before it can
 * name a trade. Step 1 finds a person, step 3 lists what they own so the caller
 * can pick something to ask for.
 *
 * These live outside `appRouter` because that file is already the whole app
 * (seasons, cards, scan, wallet) and the trading routes land next to it. Same
 * auth posture though — the router is entirely behind `requireAuth`, and the
 * caller is always `req.auth.userId`, never anything from the request.
 */
export const usersRouter = asyncRouter();

usersRouter.use(requireAuth);

/** Enough to pick a partner out of; not enough to page through the user base. */
const SEARCH_LIMIT = 20;

/** Postgres `integer` ceiling — `User.userIdNumber` is an Int column. */
const MAX_INT4 = 2147483647;

/** The columns a user is allowed to see of another user. */
const SUMMARY_SELECT = { id: true, username: true, userIdNumber: true } as const;

/**
 * Postgres rejects a null byte inside a `text` value outright — `22021 invalid
 * byte sequence for encoding "UTF8": 0x00` — so a string carrying one cannot be
 * queried with, only refused.
 *
 * The async boundary in `../async-router` already stops that rejection from
 * killing the process, but a 500 is the wrong answer to input we can classify
 * before touching the database. Refuse it at the edge and the 500 stays what it
 * should be: a bug we didn't anticipate.
 */
function hasNullByte(value: string): boolean {
  return value.includes("\0");
}

/**
 * Escape the characters `LIKE` treats as wildcards, so `q` matches literally.
 *
 * Prisma's `contains` compiles to `ILIKE '%' || $1 || '%'` and passes the value
 * through untouched — it escapes nothing. Left alone, `q=%` matches every row
 * and returns the entire user base, and `q=T_ylor` matches "Taylor" because `_`
 * is "any single character". Backslash is Postgres's default LIKE escape, and
 * it has to be escaped first-class or an input of `\%` would smuggle a wildcard
 * back in. One pass with a callback does all three without re-processing what
 * it just wrote.
 */
function likeLiteral(q: string): string {
  return q.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Parse `q` as a user ID number, or return null when it isn't one.
 *
 * `userIdNumber` is an `Int`, so a query of "abc" has no business reaching that
 * column — and neither does "99999999999999", which parses fine in JS and then
 * overflows int4 at the database. Both cases drop the numeric branch from the
 * query rather than erroring: a search for a username that happens to look like
 * a huge number should still search usernames.
 *
 * Leading zeros are rejected rather than normalised away. "0100300" is not the
 * ID a user was given, and quietly treating it as one makes an exact-match
 * lookup answer to strings that aren't the identifier. It still searches
 * usernames, which is where a string with a leading zero belongs.
 */
function asUserIdNumber(q: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/.test(q)) return null;
  const n = Number(q);
  return Number.isSafeInteger(n) && n <= MAX_INT4 ? n : null;
}

/**
 * Find someone to trade with, by username fragment or exact ID number.
 *
 * Three deliberate limits keep this a lookup rather than a directory: an empty
 * query returns nothing instead of everyone, admins never appear, and the
 * result set is capped. They make enumeration expensive rather than impossible
 * — a caller willing to walk every prefix still gets there twenty rows at a
 * time — so this is a speed bump, not an access control. What actually keeps
 * the sensitive columns safe is the `select` below.
 *
 * That `select` is not decoration. `User` carries `email` and `passwordHash`;
 * `toUserSummary` keeps them out of the response, but a bare `findMany` still
 * pulls every hash into API memory where a log line or an error dump can reach
 * it. Don't fetch what must never be shown.
 */
usersRouter.get("/search", async (req, res) => {
  const raw = String(req.query.q ?? "");
  if (hasNullByte(raw)) {
    return res.status(400).json({ error: "That search contains a character we can't look up." });
  }
  const q = raw.trim();

  // No query, no results. Returning every user here would be an address book.
  if (!q) return res.json([]);

  // You can't trade with yourself, so you shouldn't find yourself; and admins
  // are staff accounts, not trading partners.
  const eligible = { id: { not: req.auth!.userId }, isAdmin: false };

  const idNumber = asUserIdNumber(q);

  // The ID hit is fetched on its own instead of joining the username results in
  // an `OR`. Sharing one query means sharing one `take`, and the alphabetical
  // sort can then push an exact ID match past the cap — losing the single
  // result the caller was most certain about.
  const exact =
    idNumber === null
      ? null
      : await prisma.user.findFirst({
          where: { ...eligible, userIdNumber: idNumber },
          select: SUMMARY_SELECT,
        });

  const byUsername = await prisma.user.findMany({
    where: { ...eligible, username: { contains: likeLiteral(q), mode: "insensitive" } },
    select: SUMMARY_SELECT,
    orderBy: { username: "asc" },
    take: SEARCH_LIMIT,
  });

  // Exact first, then the fragment matches, and never the same person twice.
  const users = exact ? [exact, ...byUsername.filter((u) => u.id !== exact.id)] : byUsername;

  const summaries: UserSummary[] = users.slice(0, SEARCH_LIMIT).map(toUserSummary);
  res.json(summaries);
});

/**
 * What another user owns, so the caller can pick a card to request.
 *
 * Collections are public in a trading app — you cannot propose a trade for
 * something you can't see. Stated as a product decision in DESIGN.md rather
 * than left implicit here.
 *
 * `quantity >= 1` matches how ownership is defined everywhere else: the swap
 * deletes a `UserCard` row when its last copy leaves, so a row at zero is not
 * expected — filtering anyway keeps a stray one from being offered as tradable.
 * Every card goes through `toPublicCard`, which rewrites `imageUrl` into the
 * relative `/static/cards/...` path clients resolve against their own host;
 * returning the raw Prisma card breaks every image on a physical device.
 */
usersRouter.get("/:id/cards", async (req, res) => {
  // A path segment reaches Postgres just as a query string does, and a null
  // byte in one is refused by the encoding rather than answered — see
  // `hasNullByte`. No id we issue contains one, so this is never a real lookup.
  if (hasNullByte(req.params.id)) {
    return res.status(400).json({ error: "That isn't a valid user id." });
  }

  // Only the existence of the user is in question here, so only the id is read.
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!user) return res.status(404).json({ error: "User not found" });

  const owned = await prisma.userCard.findMany({
    where: { userId: user.id, quantity: { gte: 1 } },
    include: { card: true },
    orderBy: { card: { cardNumber: "asc" } },
  });

  const cards: OwnedCard[] = owned.map((uc) => ({
    ...toPublicCard(uc.card),
    quantity: uc.quantity,
    firstScannedAt: uc.firstScannedAt.toISOString(),
  }));
  res.json(cards);
});
