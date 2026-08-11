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

    expect(toPublicTrade(trade, alice.id).direction).toBe("sent");
    expect(toPublicTrade(trade, bob.id).direction).toBe("received");
  });

  it("describes the same cards regardless of who is looking", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    const asSender = toPublicTrade(trade, alice.id);
    const asRecipient = toPublicTrade(trade, bob.id);

    // "offered" is sender-relative and must not flip — only `direction` changes.
    expect(asSender.offeredCard.id).toBe(aliceOnly.id);
    expect(asRecipient.offeredCard.id).toBe(aliceOnly.id);
    expect(asSender.requestedCard.id).toBe(bobOnly.id);
    expect(asRecipient.requestedCard.id).toBe(bobOnly.id);
  });

  it("throws rather than guessing a direction for a non-participant", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    expect(() => toPublicTrade(trade, "somebody-else")).toThrow(/non-participant/);
  });

  it("rewrites imageUrl on BOTH cards, not just the offered one", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    const dto = toPublicTrade(trade, alice.id);

    expect(dto.offeredCard.imageUrl).toMatch(/^\/static\/cards\//);
    expect(dto.requestedCard.imageUrl).toMatch(/^\/static\/cards\//);
  });

  it("never leaks an email or password hash", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    const serialized = JSON.stringify(toPublicTrade(trade, alice.id));

    expect(serialized).not.toContain("@test.local");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("$2");
  });

  it("passes fulfillable through for pending trades", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    expect(toPublicTrade(trade, alice.id, true).fulfillable).toBe(true);
    expect(toPublicTrade(trade, alice.id, false).fulfillable).toBe(false);
    expect(toPublicTrade(trade, alice.id).fulfillable).toBeNull();
  });

  it("forces fulfillable to null once a trade has been answered", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();

    for (const status of ["ACCEPTED", "DECLINED"] as const) {
      await prisma.trade.deleteMany();
      const trade = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id, status);

      // Even when the caller insists, an answered trade reports null.
      expect(toPublicTrade(trade, alice.id, true).fulfillable).toBeNull();
      expect(toPublicTrade(trade, alice.id).status).toBe(status);
    }
  });

  it("serializes timestamps as ISO strings, with a null respondedAt while pending", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const pending = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id);

    const dto = toPublicTrade(pending, alice.id);
    expect(dto.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dto.respondedAt).toBeNull();

    await prisma.trade.deleteMany();
    const declined = await makeTrade(alice.id, bob.id, aliceOnly.id, bobOnly.id, "DECLINED");
    expect(toPublicTrade(declined, alice.id).respondedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
