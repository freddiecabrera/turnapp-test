import { beforeEach, describe, expect, it } from "vitest";
import { toPublicTrade, toUserSummary } from "../src/serialize";
import { prisma, resetDatabase, twoTraders } from "./helpers";

const withParties = {
  fromUser: true,
  toUser: true,
  offeredCard: true,
  requestedCard: true,
} as const;

async function makeTrade(
  fromUserId: string,
  toUserId: string,
  offeredCardId: string,
  requestedCardId: string,
  status: "PENDING" | "ACCEPTED" | "DECLINED" = "PENDING"
) {
  return prisma.trade.create({
    data: {
      fromUserId,
      toUserId,
      offeredCardId,
      requestedCardId,
      status,
      respondedAt: status === "PENDING" ? null : new Date(),
    },
    include: withParties,
  });
}

describe("toUserSummary", () => {
  it("exposes only id, username and userIdNumber", () => {
    const summary = toUserSummary({
      id: "u1",
      username: "alice",
      userIdNumber: 900001,
      // Extra fields a caller might pass in by accident.
      email: "alice@test.local",
      passwordHash: "hunter2",
    } as never);

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
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

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
