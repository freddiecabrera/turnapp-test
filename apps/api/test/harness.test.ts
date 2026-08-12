import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  authedApi,
  copiesOf,
  hasRowFor,
  prisma,
  resetDatabase,
  twoTraders,
} from "./helpers";
import { DEV_DATABASE_URL, TEST_DATABASE_URL } from "./env";

/**
 * Smoke tests for the harness itself. If these fail, no other test result in
 * this suite means anything.
 */
describe("test harness", () => {
  beforeEach(resetDatabase);

  it("runs against this worktree's own test database, not the dev one", () => {
    // `_test_<8 hex>` is the per-checkout name `env.ts` derives. Asserting the
    // shape, and not merely "different from the dev URL", is what catches a
    // derivation that quietly went back to one shared `turnapp_test`: that
    // passes every other test in this file, right up until a second worktree
    // runs `migrate reset` on the tables this one is using.
    expect(process.env.DATABASE_URL).toMatch(/_test_[0-9a-f]{8}(\?|$)/);
    expect(process.env.DATABASE_URL).toBe(TEST_DATABASE_URL);
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

/**
 * The HTTP path: the real Express app, driven in-process. Proves the routing
 * stack, the auth middleware, and the app's own Prisma client all reach the
 * test database, so route tests can be written against behaviour rather than
 * against handlers called directly.
 */
describe("http harness", () => {
  beforeEach(resetDatabase);

  it("serves an unauthenticated GET /health", async () => {
    const res = await api().get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects GET /cards without a token", async () => {
    const res = await api().get("/cards");

    expect(res.status).toBe(401);
  });

  it("serves GET /cards for a signed-in user, from the test database", async () => {
    const { alice, common, bobOnly } = await twoTraders();

    const res = await authedApi(alice, "get", "/cards");
    expect(res.status).toBe(200);

    const cards = res.body as Array<{ id: string; owned: boolean; quantity: number }>;

    // Exactly the four cards this test created. The dev database has fifteen
    // seeded ones, so the count alone proves which database served the request.
    expect(cards).toHaveLength(4);
    expect(cards.find((c) => c.id === common.id)).toMatchObject({
      owned: true,
      quantity: 1,
    });
    expect(cards.find((c) => c.id === bobOnly.id)).toMatchObject({
      owned: false,
      quantity: 0,
    });
  });
});
