import { beforeEach, describe, expect, it } from "vitest";
import type { Trade } from "@turnapp/shared";
import {
  api,
  authedApi,
  copiesOf,
  createUser,
  prisma,
  resetDatabase,
  twoTraders,
} from "./helpers";

/**
 * Declining a trade, driven over HTTP so auth, routing and the serializer are
 * all in the path.
 *
 * Decline's entire behaviour is a refusal plus an absence: the status flips and
 * *nothing else changes*. An absence is the one thing a status-code assertion
 * cannot see, so almost every case here captures both collections before the
 * request and compares them afterwards. A decline that quietly moved a card
 * would pass every status assertion in this file and cost somebody a
 * collectible.
 *
 * Setup writes trades with Prisma rather than `POST /trades`, matching the
 * accept suite: the create endpoint has its own tests, and going through it
 * here would both couple these cases to it and make states like
 * "already answered" unconstructable. The one exception is the re-offer case at
 * the bottom, where the create endpoint *is* the thing under test.
 */

/** Anything that looks like an address or a bcrypt hash, anywhere in a body. */
function leaks(body: unknown): boolean {
  const json = JSON.stringify(body);
  return json.includes("@") || json.includes("$2");
}

/**
 * The exact strings this endpoint answers with, as literals rather than imports
 * from the route. They are user-facing copy — a test that imported the constant
 * would agree with any rewrite of it, including an accidental one.
 */
const NOT_FOUND = "We couldn't find that trade.";
const NOT_YOURS = "Only the person this trade was sent to can decline it.";
const ALREADY_ANSWERED = "This trade has already been answered. Refresh to see how it ended.";
const DUPLICATE_OFFER = "You've already sent this offer. Check your sent requests.";

function decline(user: { id: string; isAdmin: boolean }, tradeId: string) {
  return authedApi(user, "post", `/trades/${tradeId}/decline`);
}

function accept(user: { id: string; isAdmin: boolean }, tradeId: string) {
  return authedApi(user, "post", `/trades/${tradeId}/accept`);
}

/** A pending trade, written straight to the database. */
async function pendingTrade(opts: {
  fromUserId: string;
  toUserId: string;
  offeredCardId: string;
  requestedCardId: string;
}) {
  return prisma.trade.create({ data: opts });
}

/**
 * Every `UserCard` row in the database, in a stable order.
 *
 * The whole row, not just the quantity: `id` and `firstScannedAt` are columns a
 * decline must also leave alone, and comparing the lot is how "nothing changed"
 * stops meaning "nothing I remembered to look at changed".
 */
async function allHoldings() {
  return prisma.userCard.findMany({ orderBy: [{ userId: "asc" }, { cardId: "asc" }] });
}

/**
 * Both parties' collections as each of them can actually see them.
 *
 * `allHoldings` reads the table; this reads the API. They fail to agree only if
 * something moved through a path that doesn't write `UserCard` directly — and
 * `owned`/`quantity` on `GET /cards` is the surface a user would notice, which
 * makes it the one worth asserting on as well as the rows underneath it.
 */
async function collectionsOf(users: Array<{ id: string; isAdmin: boolean }>) {
  const snapshots = [];
  for (const user of users) {
    const res = await authedApi(user, "get", "/cards");
    expect(res.status).toBe(200);
    const cards = res.body as Array<{ id: string; owned: boolean; quantity: number }>;
    snapshots.push(cards.map((c) => ({ id: c.id, owned: c.owned, quantity: c.quantity })));
  }
  return snapshots;
}

/** The stored trade row, which is the only authority on what actually happened. */
function storedTrade(id: string) {
  return prisma.trade.findUniqueOrThrow({ where: { id } });
}

describe("POST /trades/:id/decline", () => {
  beforeEach(resetDatabase);

  describe("on success", () => {
    it("marks the trade declined and stamps respondedAt", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const res = await decline(bob, trade.id);

      expect(res.status).toBe(200);
      const stored = await storedTrade(trade.id);
      expect(stored.status).toBe("DECLINED");
      expect(stored.respondedAt).not.toBeNull();
      expect(stored.respondedAt!.getTime()).toBeGreaterThanOrEqual(stored.createdAt.getTime());
      expect(Date.now() - stored.respondedAt!.getTime()).toBeLessThan(10_000);
    });

    it("returns the trade as the decliner sees it, with fulfillable null", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const res = await decline(bob, trade.id);

      const body = res.body as Trade;
      expect(body.id).toBe(trade.id);
      expect(body.status).toBe("DECLINED");
      // Bob received this offer, so it reads "received" to him however the row
      // is stored — the columns are sender-relative.
      expect(body.direction).toBe("received");
      // Not false. An answered trade has no fulfillability left to describe,
      // and false would read to a client as "this one couldn't have worked".
      expect(body.fulfillable).toBeNull();
      expect(body.fromUser).toEqual({
        id: alice.id,
        username: alice.username,
        userIdNumber: alice.userIdNumber,
      });
      expect(body.toUser).toEqual({
        id: bob.id,
        username: bob.username,
        userIdNumber: bob.userIdNumber,
      });
      expect(body.offeredCard.id).toBe(aliceOnly.id);
      expect(body.requestedCard.id).toBe(bobOnly.id);
      expect(body.respondedAt).not.toBeNull();
      expect(new Date(body.respondedAt!).toISOString()).toBe(body.respondedAt);
    });

    it("rewrites both card images to the relative /static/cards path", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const res = await decline(bob, trade.id);

      const body = res.body as Trade;
      expect(aliceOnly.imageUrl).toBeTruthy();
      expect(body.offeredCard.imageUrl).toBe(`/static/cards/${aliceOnly.imageUrl}`);
      expect(body.requestedCard.imageUrl).toBe(`/static/cards/${bobOnly.imageUrl}`);
    });

    it("never returns an email address or a password hash", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const res = await decline(bob, trade.id);

      expect(leaks(res.body)).toBe(false);
      expect(Object.keys((res.body as Trade).fromUser).sort()).toEqual([
        "id",
        "userIdNumber",
        "username",
      ]);
    });
  });

  describe("nothing moves", () => {
    it("leaves every UserCard row in the database untouched", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const before = await allHoldings();
      // The fixture is not trivially empty, or "unchanged" would be cheap.
      expect(before.length).toBe(5);

      const res = await decline(bob, trade.id);
      expect(res.status).toBe(200);

      // Byte-identical rows, not merely "the two traded cards are still where
      // they were": quantities, ids and firstScannedAt all have to survive.
      expect(await allHoldings()).toEqual(before);
    });

    it("leaves both parties' collections identical over the API", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const before = await collectionsOf([alice, bob]);

      const res = await decline(bob, trade.id);
      expect(res.status).toBe(200);

      // The full collection for each of them, as each of them sees it —
      // `owned` and `quantity` for every card in the season, not just the two
      // this trade named. "On decline, nothing changes" is the claim, so the
      // whole collection is what has to be equal.
      expect(await collectionsOf([alice, bob])).toEqual(before);
      // Spelled out for the two cards that would have moved, so a failure here
      // names the thing that broke rather than dumping two arrays.
      expect(await copiesOf(alice.id, aliceOnly.id)).toBe(1);
      expect(await copiesOf(bob.id, bobOnly.id)).toBe(1);
      expect(await copiesOf(bob.id, aliceOnly.id)).toBe(0);
      expect(await copiesOf(alice.id, bobOnly.id)).toBe(0);
    });

    it("writes no UserCard row even when the sender has since lost the card", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      // Accept would 409 here. Decline must not: a dead offer is exactly the
      // one a recipient most wants off their board, and refusing to let them
      // refuse it would leave it pending forever.
      await prisma.userCard.delete({
        where: { userId_cardId: { userId: alice.id, cardId: aliceOnly.id } },
      });
      const before = await allHoldings();

      const res = await decline(bob, trade.id);

      expect(res.status).toBe(200);
      expect((res.body as Trade).status).toBe("DECLINED");
      expect(await allHoldings()).toEqual(before);
      expect((await storedTrade(trade.id)).status).toBe("DECLINED");
    });
  });

  describe("403 — only the recipient answers", () => {
    it("refuses the sender declining their own offer", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const before = await allHoldings();

      const res = await decline(alice, trade.id);

      // Withdrawing an offer you sent is a different verb from the recipient
      // refusing it, and `status` exists to record what a human did. Letting
      // the sender write DECLINED would file their change of mind as the other
      // person's rejection.
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: NOT_YOURS });
      expect(await allHoldings()).toEqual(before);
      const stored = await storedTrade(trade.id);
      expect(stored.status).toBe("PENDING");
      expect(stored.respondedAt).toBeNull();
    });

    it("refuses an unrelated third user", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const carol = await createUser("carol");
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const before = await allHoldings();

      const res = await decline(carol, trade.id);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: NOT_YOURS });
      expect(await allHoldings()).toEqual(before);
      expect((await storedTrade(trade.id)).status).toBe("PENDING");
    });

    it("401s without a token", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const before = await allHoldings();

      const res = await api().post(`/trades/${trade.id}/decline`);

      expect(res.status).toBe(401);
      expect(await allHoldings()).toEqual(before);
      expect((await storedTrade(trade.id)).status).toBe("PENDING");
    });
  });

  describe("409 — already answered", () => {
    it("refuses a trade that was already declined", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const first = await decline(bob, trade.id);
      expect(first.status).toBe(200);
      const firstRespondedAt = (await storedTrade(trade.id)).respondedAt!;

      const second = await decline(bob, trade.id);

      expect(second.status).toBe(409);
      expect(second.body).toEqual({ error: ALREADY_ANSWERED });
      // The moment it was declined is part of the record. A second decline
      // that "succeeded" harmlessly would still rewrite this.
      const stored = await storedTrade(trade.id);
      expect(stored.status).toBe("DECLINED");
      expect(stored.respondedAt!.getTime()).toBe(firstRespondedAt.getTime());
    });

    it("refuses a trade that was already accepted, and un-swaps nothing", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const accepted = await accept(bob, trade.id);
      expect(accepted.status).toBe(200);
      const afterAccept = await allHoldings();

      const res = await decline(bob, trade.id);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: ALREADY_ANSWERED });
      // Declining a completed trade must not read as an undo. The cards stay
      // where the accept put them.
      expect(await allHoldings()).toEqual(afterAccept);
      expect((await storedTrade(trade.id)).status).toBe("ACCEPTED");
    });

    it("makes a later accept impossible", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const before = await allHoldings();

      expect((await decline(bob, trade.id)).status).toBe(200);
      const res = await accept(bob, trade.id);

      // The direction that matters most: a declined trade must never be able
      // to move a card afterwards.
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: ALREADY_ANSWERED });
      expect(await allHoldings()).toEqual(before);
      expect((await storedTrade(trade.id)).status).toBe("DECLINED");
    });
  });

  describe("404 — no such trade", () => {
    it("404s for an unknown id", async () => {
      const { bob } = await twoTraders();
      const before = await allHoldings();

      const res = await decline(bob, "no-such-trade");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: NOT_FOUND });
      expect(await allHoldings()).toEqual(before);
    });
  });

  describe("concurrency", () => {
    it("lets exactly one of two simultaneous declines through", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const before = await allHoldings();

      // Both in flight before either finishes. The loser contends on the Trade
      // row inside the guarded claim, blocks, re-reads, and finds the row is no
      // longer PENDING.
      const results = await Promise.all([decline(bob, trade.id), decline(bob, trade.id)]);

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body).toEqual({ error: ALREADY_ANSWERED });
      expect((await storedTrade(trade.id)).status).toBe("DECLINED");
      expect(await prisma.trade.count({ where: { status: "DECLINED" } })).toBe(1);
      expect(await allHoldings()).toEqual(before);
    });

    it("lets exactly one of a simultaneous accept and decline through", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const before = await allHoldings();

      const [accepted, declined] = await Promise.all([
        accept(bob, trade.id),
        decline(bob, trade.id),
      ]);

      // Which one wins is a genuine race and neither answer is wrong. What
      // must hold either way is that the cards agree with the status: the
      // failure mode this catches is a decline that lands on top of an accept
      // and leaves the trade DECLINED with the cards already swapped.
      expect([accepted.status, declined.status].sort((a, b) => a - b)).toEqual([200, 409]);
      const stored = await storedTrade(trade.id);

      if (accepted.status === 200) {
        expect(stored.status).toBe("ACCEPTED");
        expect(await copiesOf(alice.id, aliceOnly.id)).toBe(0);
        expect(await copiesOf(bob.id, aliceOnly.id)).toBe(1);
        expect(await copiesOf(bob.id, bobOnly.id)).toBe(0);
        expect(await copiesOf(alice.id, bobOnly.id)).toBe(1);
      } else {
        expect(stored.status).toBe("DECLINED");
        expect(await allHoldings()).toEqual(before);
      }
    });
  });

  describe("declining releases the offer", () => {
    it("lets the same four-field offer be sent again", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const offer = {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      };

      const first = await authedApi(alice, "post", "/trades").send(offer);
      expect(first.status).toBe(201);
      const firstId = (first.body as Trade).id;

      // While it is pending the partial unique index holds the slot, so the
      // contrast below is a real one rather than an untested assumption.
      const duplicate = await authedApi(alice, "post", "/trades").send(offer);
      expect(duplicate.status).toBe(409);
      expect(duplicate.body).toEqual({ error: DUPLICATE_OFFER });

      expect((await decline(bob, firstId)).status).toBe(200);

      // The index is partial on PENDING, so declining frees the slot: a
      // refused offer can be made again after a conversation, which is the
      // whole reason it is partial rather than total.
      const second = await authedApi(alice, "post", "/trades").send(offer);
      expect(second.status).toBe(201);
      const secondId = (second.body as Trade).id;
      expect(secondId).not.toBe(firstId);

      // Both rows survive — `Trade` is a permanent log, not a queue.
      expect((await storedTrade(firstId)).status).toBe("DECLINED");
      expect((await storedTrade(secondId)).status).toBe("PENDING");
      expect(await prisma.trade.count()).toBe(2);
    });
  });

  describe("the async boundary", () => {
    it("turns a rejected query into a JSON 500 and keeps serving", async () => {
      const { bob } = await twoTraders();

      // A null byte is refused by Postgres inside a `text` value — `22021` —
      // whatever the query around it. On a plain express.Router() that
      // rejection is unhandled and Node 20 exits, taking the API down for
      // everybody; here it has to come back as a 500.
      const res = await decline(bob, "a%00b");

      expect(res.status).toBe(500);
      expect(typeof (res.body as { error?: unknown }).error).toBe("string");
      // Nothing derived from the error: a Prisma message carries the failing
      // query and an absolute path into the source tree.
      expect(res.text).not.toContain("prisma.");
      expect(res.text).not.toContain("/Users/");

      const health = await api().get("/health");
      expect(health.status).toBe(200);
    });
  });
});
