import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import supertest from "supertest";
import { signToken } from "../src/auth";
import { app } from "../src/app";
import { TEST_DATABASE_URL } from "./env";

/**
 * Test-only Prisma client, bound to the test database at construction.
 *
 * The URL is passed explicitly rather than left to vitest.config.ts's
 * `test.env`, which applies to worker processes only: a globalSetup or
 * globalTeardown importing `resetDatabase` would otherwise get a client on the
 * *dev* database and TRUNCATE it. Constructing with the URL makes reaching the
 * dev database structurally impossible instead of merely unlikely.
 */
export const prisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});

// Fixture counters, kept unique per test rather than per run — see resetDatabase.
let userSeq = 0;
let cardSeq = 0;

/**
 * Wipe every application table between tests so cases are order-independent.
 *
 * Truncation rather than a wrapping transaction: the code under test opens its
 * own `$transaction`, and nesting would change the very semantics we are
 * verifying.
 *
 * The table list is read from the catalogue rather than hardcoded. A hardcoded
 * list silently stops covering any future model that doesn't happen to FK into
 * one of the named tables, and that leaks rows across every test in the suite.
 * One cheap catalogue query per test buys immunity to that.
 * `_prisma_migrations` is deliberately left alone.
 */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
  `;

  if (tables.length > 0) {
    const list = tables.map((t) => `"${t.table_name}"`).join(", ");
    // No RESTART IDENTITY: every primary key is a cuid TEXT default, so there
    // is not a sequence in the schema for it to restart.
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  }

  // The fixture counters above are part of the state a test starts from, so
  // they reset with the tables — otherwise the values a case sees would depend
  // on how many cases ran before it.
  userSeq = 0;
  cardSeq = 0;
}

export async function createUser(
  username: string,
  opts: { isAdmin?: boolean } = {}
) {
  userSeq += 1;
  return prisma.user.create({
    data: {
      username,
      email: `${username}@test.local`,
      passwordHash: await bcrypt.hash("test123", 4),
      userIdNumber: 900000 + userSeq,
      isAdmin: opts.isAdmin ?? false,
    },
  });
}

export async function createSeason(name = "Test Season") {
  return prisma.season.create({ data: { name } });
}

export async function createCard(seasonId: string, name: string) {
  cardSeq += 1;
  return prisma.card.create({
    data: {
      name,
      seasonId,
      cardNumber: String(cardSeq).padStart(2, "0"),
      rarity: "daycard",
      imageUrl: `${cardSeq}_${name.toLowerCase().replace(/\W+/g, "-")}.png`,
    },
  });
}

/** Give a user `quantity` copies of a card. */
export async function grant(userId: string, cardId: string, quantity = 1) {
  return prisma.userCard.upsert({
    where: { userId_cardId: { userId, cardId } },
    create: { userId, cardId, quantity },
    update: { quantity: { increment: quantity } },
  });
}

/** How many copies a user holds. Returns 0 when the row is absent. */
export async function copiesOf(userId: string, cardId: string): Promise<number> {
  const row = await prisma.userCard.findUnique({
    where: { userId_cardId: { userId, cardId } },
  });
  return row?.quantity ?? 0;
}

/** True when a UserCard row exists at all — distinct from holding zero copies. */
export async function hasRowFor(userId: string, cardId: string): Promise<boolean> {
  const row = await prisma.userCard.findUnique({
    where: { userId_cardId: { userId, cardId } },
  });
  return row !== null;
}

/**
 * Every copy of a card in existence, across all collections.
 *
 * The number a race must conserve. Per-user assertions say where the copies
 * are; this one says how many there are, which is the property a trade cannot
 * be allowed to change and a scan may only change by one.
 */
export async function totalCopiesOf(cardId: string): Promise<number> {
  const { _sum } = await prisma.userCard.aggregate({
    where: { cardId },
    _sum: { quantity: true },
  });
  return _sum.quantity ?? 0;
}

/** A single-use QR code granting `cardId`. */
export async function createQrCode(cardId: string, code: string, pointsAwarded = 50) {
  return prisma.qrCode.create({ data: { code, cardId, pointsAwarded } });
}

/**
 * Dispatch a supertest request now, rather than when it is awaited.
 *
 * A supertest `Test` is lazy — it sends nothing until something calls `.then`.
 * Two requests that are only awaited later are two requests that never
 * overlapped, so a concurrency test built that way is a sequential test with a
 * misleading name.
 */
export function inFlight<T>(request: PromiseLike<T>): Promise<T> {
  return Promise.resolve(request.then((value) => value));
}

/**
 * Block until `count` backends are waiting on a lock in the test database.
 *
 * `wait_event_type = 'Lock'` is a heavyweight lock wait — a query parked on a
 * row another transaction holds. That is the observable that says a request has
 * reached the write we care about and gone no further, which is what lets a
 * test place one request *inside* another's transaction instead of hoping the
 * scheduler does it.
 *
 * Throws rather than returning on timeout: a concurrency test whose setup
 * silently didn't happen is worse than no test.
 */
export async function waitForLockWaiters(count: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [{ waiting }] = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    if (waiting >= count) return;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${count} blocked queries; saw ${waiting}.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Hold an exclusive lock on one `UserCard` row for the duration of `body`.
 *
 * Two requests fired with `Promise.all` interleave however the event loop and
 * the connection pool feel like that run — which is fine when every ordering
 * must produce the same answer, and useless when the bug lives in one specific
 * ordering. Locking the row both requests are about turns "eventually one of
 * them blocks" into "this one blocks, here, until I say so": fire a request,
 * wait for it to park on this lock, fire the next, then release and let the
 * queue drain in the order they arrived.
 *
 * The requests are genuinely concurrent throughout — both are in flight, in
 * their own transactions, at the same time. Only the interleaving is pinned.
 *
 * The lock is taken on a real Postgres connection, so the row must already
 * exist; a missing row would take no lock and quietly turn every test using it
 * back into a race.
 */
export async function withUserCardLocked<T>(
  userId: string,
  cardId: string,
  body: () => Promise<T>
): Promise<T> {
  let acquired!: () => void;
  const isAcquired = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  let release!: () => void;
  const isReleased = new Promise<void>((resolve) => {
    release = resolve;
  });

  // A longer timeout than Prisma's 5s default: this transaction is deliberately
  // idle while the test drives requests into it. Vitest's own 5s per-test
  // timeout is the real backstop, and it reports the failing test by name.
  const holder = prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "UserCard"
        WHERE "userId" = ${userId} AND "cardId" = ${cardId}
        FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw new Error(`Expected exactly one UserCard row to lock, found ${locked.length}.`);
      }
      acquired();
      await isReleased;
    },
    { timeout: 30_000, maxWait: 10_000 }
  );

  // Race, not a bare await: if the lock can't be taken the holder rejects, and
  // waiting on `isAcquired` alone would hang until the test timed out with no
  // hint of why.
  await Promise.race([isAcquired, holder]);

  try {
    return await body();
  } finally {
    release();
    await holder;
  }
}

export function authHeaderFor(user: { id: string; isAdmin: boolean }) {
  return `Bearer ${signToken({ userId: user.id, isAdmin: user.isAdmin })}`;
}

/**
 * HTTP client for the real Express app, in-process.
 *
 * supertest binds an ephemeral port per request and closes it afterwards, so
 * this neither needs nor collides with a dev server on 4000. The app itself is
 * importable because `src/app.ts` only builds it — `src/index.ts` is what calls
 * `listen`.
 *
 * Requests go through the app's own `prisma` client, which reads DATABASE_URL
 * from the environment vitest.config.ts gives the workers: the test database.
 */
export const api = () => supertest(app);

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/** `api()` with this user's bearer token already attached. */
export function authedApi(
  user: { id: string; isAdmin: boolean },
  method: HttpMethod,
  url: string
) {
  return api()[method](url).set("Authorization", authHeaderFor(user));
}

/**
 * Two users with deliberately overlapping and non-overlapping collections —
 * the minimum needed to exercise a trade in both directions.
 *
 *   alice: 1x common, 1x aliceOnly, 2x dupe
 *   bob:   1x common, 1x bobOnly
 */
export async function twoTraders() {
  const season = await createSeason();
  const [common, aliceOnly, bobOnly, dupe] = await Promise.all([
    createCard(season.id, "Common"),
    createCard(season.id, "Alice Only"),
    createCard(season.id, "Bob Only"),
    createCard(season.id, "Dupe"),
  ]);

  const alice = await createUser("alice");
  const bob = await createUser("bob");

  await grant(alice.id, common.id);
  await grant(alice.id, aliceOnly.id);
  await grant(alice.id, dupe.id, 2);
  await grant(bob.id, common.id);
  await grant(bob.id, bobOnly.id);

  return { season, alice, bob, common, aliceOnly, bobOnly, dupe };
}
