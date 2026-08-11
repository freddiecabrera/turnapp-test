import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { signToken } from "../src/auth";

/**
 * Test-only Prisma client. Its DATABASE_URL is set to the test database by
 * vitest.config.ts, so importing this can never reach the dev database.
 */
export const prisma = new PrismaClient();

/**
 * Wipe every application table between tests so cases are order-independent.
 *
 * Truncation rather than a wrapping transaction: the code under test opens its
 * own `$transaction`, and nesting would change the very semantics we are
 * verifying. `_prisma_migrations` is deliberately left alone.
 */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Trade",
      "UserCard",
      "PointsTransaction",
      "QrCode",
      "Card",
      "Season",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

let userSeq = 0;
let cardSeq = 0;

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
