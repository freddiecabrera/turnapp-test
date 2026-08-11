import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDatabase, twoTraders, copiesOf, hasRowFor } from "./helpers";
import { DEV_DATABASE_URL } from "./env";

/**
 * Smoke tests for the harness itself. If these fail, no other test result in
 * this suite means anything.
 */
describe("test harness", () => {
  beforeEach(resetDatabase);

  it("runs against the test database, not the dev one", () => {
    expect(process.env.DATABASE_URL).toMatch(/_test(\?|$)/);
    expect(process.env.DATABASE_URL).not.toBe(DEV_DATABASE_URL);
  });

  it("has the Trade table and its enum available", async () => {
    const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT count(*)::bigint AS count FROM "Trade"'
    );
    expect(Number(count)).toBe(0);
  });

  it("builds two traders with overlapping collections", async () => {
    const { alice, bob, common, aliceOnly, dupe } = await twoTraders();

    expect(await copiesOf(alice.id, common.id)).toBe(1);
    expect(await copiesOf(bob.id, common.id)).toBe(1);
    expect(await copiesOf(alice.id, dupe.id)).toBe(2);
    expect(await copiesOf(bob.id, aliceOnly.id)).toBe(0);
    expect(await hasRowFor(bob.id, aliceOnly.id)).toBe(false);
  });

  it("leaves no rows behind between tests", async () => {
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.card.count()).toBe(0);
    expect(await prisma.trade.count()).toBe(0);
  });
});
