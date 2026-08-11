import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { signToken } from "../src/auth";
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

export function authHeaderFor(user: { id: string; isAdmin: boolean }) {
  return `Bearer ${signToken({ userId: user.id, isAdmin: user.isAdmin })}`;
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
