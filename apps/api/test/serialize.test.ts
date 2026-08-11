import { beforeEach, describe, expect, it } from "vitest";
import { TRADE_WITH_PARTIES, toPublicTrade, toUserSummary } from "../src/serialize";
import { prisma, resetDatabase, twoTraders } from "./helpers";

function tradeData(
  fromUserId: string,
  toUserId: string,
  offeredCardId: string,
  requestedCardId: string,
  status: "PENDING" | "ACCEPTED" | "DECLINED"
) {
  return {
    fromUserId,
    toUserId,
    offeredCardId,
    requestedCardId,
    status,
    respondedAt: status === "PENDING" ? null : new Date(),
  };
}

/**
 * A trade shaped exactly the way the routes hand one to `toPublicTrade`.
 *
 * The include is the serializer's own exported constant rather than a copy, so
 * these cases cannot go on passing after the real select stops matching what
 * `toPublicTrade` reads.
 */
async function makeTrade(
  fromUserId: string,
  toUserId: string,
  offeredCardId: string,
  requestedCardId: string,
  status: "PENDING" | "ACCEPTED" | "DECLINED" = "PENDING"
) {
  return prisma.trade.create({
    data: tradeData(fromUserId, toUserId, offeredCardId, requestedCardId, status),
    include: TRADE_WITH_PARTIES,
  });
}

/**
 * The same trade with the parties pulled in whole — `email`, `passwordHash` and
 * all.
 *
 * `TRADE_WITH_PARTIES` selects three user columns precisely so those two never
 * enter API memory, which means a leak assertion against a row built from it
 * passes without the serializer doing anything. This is the row that makes the
 * assertion mean something: the fields are present on the way in, and the
 * serializer is the only reason they are absent on the way out. It is also the
 * shape a caller who reached for `include: { fromUser: true }` would produce.
 */
async function makeWideTrade(
  fromUserId: string,
  toUserId: string,
  offeredCardId: string,
  requestedCardId: string
) {
  return prisma.trade.create({
    data: tradeData(fromUserId, toUserId, offeredCardId, requestedCardId, "PENDING"),
    include: { fromUser: true, toUser: true, offeredCard: true, requestedCard: true },
  });
}

describe("toUserSummary", () => {
  it("exposes only id, username and userIdNumber", () => {
    // Bound to a variable first, on purpose. `toUserSummary` takes a
    // `Pick<PrismaUser, ...>`, and a fresh object literal handed straight to it
    // trips TypeScript's excess-property check on `email` and `passwordHash` —
    // which is the scenario under test, not something to design out. Binding
    // loses that freshness and the call is accepted structurally, with every
    // field still checked: `userIdNumber: "900001"` here is still a compile
    // error. `as never` also silenced the excess-property check, but it is
    // assignable to everything, so it silenced that one too.
    const fullRow = {
      id: "u1",
      username: "alice",
      userIdNumber: 900001,
      // The two fields the serializer exists to drop.
      email: "alice@test.local",
      passwordHash: "hunter2",
    };

    const summary = toUserSummary(fullRow);

    // `Pick<>` narrows what the signature asks for, not what arrives: the
    // hand-written field copy inside `toUserSummary` is the only thing keeping
    // the extra two from coming back out.
    expect(summary).toEqual({ id: "u1", username: "alice", userIdNumber: 900001 });
    expect(Object.keys(summary)).toHaveLength(3);
  });
});

describe("toPublicTrade", () => {
  beforeEach(resetDatabase);

  it("reads as 'sent' for the sender and 'received' for the recipient", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    expect(toPublicTrade(trade, alice.id, null).direction).toBe("sent");
    expect(toPublicTrade(trade, bob.id, null).direction).toBe("received");
  });

  it("keeps the parties on the correct sides for both viewers", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    // direction is derived from the scalar ids while fromUser/toUser come from
    // the relations, so a swap here is invisible to the direction assertions.
    for (const viewer of [alice.id, bob.id]) {
      const dto = toPublicTrade(trade, viewer, null);
      expect(dto.fromUser.id).toBe(alice.id);
      expect(dto.fromUser.username).toBe("alice");
      expect(dto.toUser.id).toBe(bob.id);
      expect(dto.toUser.username).toBe("bob");
    }
  });

  it("carries the trade's own id, not a card's", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    // This id is what POST /trades/:id/accept gets called with.
    expect(toPublicTrade(trade, alice.id, null).id).toBe(trade.id);
  });

  it("describes the same cards regardless of who is looking", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    const asSender = toPublicTrade(trade, alice.id, null);
    const asRecipient = toPublicTrade(trade, bob.id, null);

    // "offered" is sender-relative and must not flip — only `direction` changes.
    expect(asSender.offeredCard.id).toBe(aliceOnly.id);
    expect(asRecipient.offeredCard.id).toBe(aliceOnly.id);
    expect(asSender.requestedCard.id).toBe(bobOnly.id);
    expect(asRecipient.requestedCard.id).toBe(bobOnly.id);
  });

  it("throws rather than guessing a direction for a non-participant", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    expect(() => toPublicTrade(trade, "somebody-else", null)).toThrow(/non-participant/);
  });

  it("rewrites imageUrl on BOTH cards, not just the offered one", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    const dto = toPublicTrade(trade, alice.id, null);

    expect(dto.offeredCard.imageUrl).toMatch(/^\/static\/cards\//);
    expect(dto.requestedCard.imageUrl).toMatch(/^\/static\/cards\//);
  });

  it("never leaks an email or password hash", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    // Deliberately the wide row: both fields are on the input, so their absence
    // from the output is the serializer's doing and not the select's.
    const trade = await makeWideTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    const serialized = JSON.stringify(toPublicTrade(trade, alice.id, null));

    expect(serialized).not.toContain("@test.local");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("$2");
  });

  it("passes fulfillable through for pending trades", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    expect(toPublicTrade(trade, alice.id, true).fulfillable).toBe(true);
    expect(toPublicTrade(trade, alice.id, false).fulfillable).toBe(false);
    expect(toPublicTrade(trade, alice.id, null).fulfillable).toBeNull();
  });

  it("forces fulfillable to null once a trade has been answered", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();

    for (const status of ["ACCEPTED", "DECLINED"] as const) {
      const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id, status);

      // Even when the caller insists, an answered trade reports null.
      expect(toPublicTrade(trade, alice.id, true).fulfillable).toBeNull();
      expect(toPublicTrade(trade, alice.id, null).status).toBe(status);
    }
  });

  it("serializes timestamps as ISO strings, with a null respondedAt while pending", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const pending = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    const dto = toPublicTrade(pending, alice.id, null);
    expect(dto.createdAt).toBe(pending.createdAt.toISOString());
    expect(dto.respondedAt).toBeNull();

    const declined = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id, "DECLINED");
    expect(toPublicTrade(declined, alice.id, null).respondedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
