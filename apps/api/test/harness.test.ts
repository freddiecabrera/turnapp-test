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

  it("has the hand-written constraints from the trades migration", async () => {
    // `migrate deploy` would not have re-applied these after the hand-edit, so
    // this also guards the global setup against regressing to it.
    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE conrelid = '"Trade"'::regclass
    `;
    const names = constraints.map((c) => c.conname);
    expect(names).toContain("Trade_no_self_trade");
    expect(names).toContain("Trade_distinct_cards");

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'Trade'
    `;
    expect(indexes.map((i) => i.indexname)).toContain("Trade_one_pending_per_offer");
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
