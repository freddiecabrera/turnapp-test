import { beforeEach, describe, expect, it } from "vitest";
import type { Trade } from "@turnapp/shared";
import {
  api,
  authedApi,
  copiesOf,
  createUser,
  grant,
  hasRowFor,
  prisma,
  resetDatabase,
  twoTraders,
} from "./helpers";

/**
 * Accepting a trade, driven over HTTP so auth, routing and the serializer are
 * all in the path.
 *
 * This is the only endpoint in the app that moves something between two people,
 * so nearly every case here asserts the collections as well as the status code.
 * A 409 that also moved a card would pass a status-only test and lose somebody
 * their collectible, and the two failures that matter — a second accept, and an
 * accept after the card was traded away — are precisely the ones where the
 * status code and the data can disagree.
 *
 * Setup writes trades with Prisma rather than `POST /trades`. The create
 * endpoint has its own suite; going through it here would make every case below
 * fail when *it* breaks, and would stop these tests constructing the states
 * that matter (an already-answered trade, three open offers for one copy).
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
const NOT_YOURS = "Only the person this trade was sent to can accept it.";
const ALREADY_ANSWERED = "This trade has already been answered. Refresh to see how it ended.";
const SENDER_LOST_IT = "They no longer have the card they offered, so this trade can't go through.";
const YOU_LOST_IT = "You no longer have the card they asked for, so this trade can't go through.";

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
 * rolled-back swap must also leave alone, and comparing the lot is how "nothing
 * moved" stops meaning "nothing I remembered to look at moved".
 */
async function allHoldings() {
  return prisma.userCard.findMany({ orderBy: [{ userId: "asc" }, { cardId: "asc" }] });
}

/** The stored trade row, which is the only authority on what actually happened. */
function storedTrade(id: string) {
  return prisma.trade.findUniqueOrThrow({ where: { id } });
}

describe("POST /trades/:id/accept", () => {
  beforeEach(resetDatabase);

  describe("on success", () => {
    it("swaps both cards and marks the trade accepted", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const res = await accept(bob, trade.id);

      expect(res.status).toBe(200);

      // Both directions, both sides. Each card left one collection and arrived
      // in the other — a swap that only half happened would satisfy either
      // pair of these on its own.
      expect(await copiesOf(alice.id, aliceOnly.id)).toBe(0);
      expect(await copiesOf(bob.id, aliceOnly.id)).toBe(1);
      expect(await copiesOf(bob.id, bobOnly.id)).toBe(0);
      expect(await copiesOf(alice.id, bobOnly.id)).toBe(1);

      const stored = await storedTrade(trade.id);
      expect(stored.status).toBe("ACCEPTED");
      expect(stored.respondedAt).not.toBeNull();
      expect(stored.respondedAt!.getTime()).toBeGreaterThanOrEqual(stored.createdAt.getTime());
      expect(Date.now() - stored.respondedAt!.getTime()).toBeLessThan(10_000);
    });

    it("returns the trade as the accepter sees it, with fulfillable null", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const res = await accept(bob, trade.id);

      const body = res.body as Trade;
      expect(body.id).toBe(trade.id);
      expect(body.status).toBe("ACCEPTED");
      // Bob received this offer, so it reads "received" to him however the row
      // is stored — the columns are sender-relative.
      expect(body.direction).toBe("received");
      // Not false. An answered trade has no fulfillability left to describe,
      // and false would read to a client as "this one failed".
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

      const res = await accept(bob, trade.id);

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

      const res = await accept(bob, trade.id);

      expect(leaks(res.body)).toBe(false);
      expect(Object.keys((res.body as Trade).fromUser).sort()).toEqual([
        "id",
        "userIdNumber",
        "username",
      ]);
    });
  });

  describe("403 — only the recipient answers", () => {
    it("refuses the sender accepting their own offer", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const before = await allHoldings();

      const res = await accept(alice, trade.id);

      // Otherwise anyone could take a card simply by offering for it.
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: NOT_YOURS });
      expect(await allHoldings()).toEqual(before);
      expect((await storedTrade(trade.id)).status).toBe("PENDING");
      expect((await storedTrade(trade.id)).respondedAt).toBeNull();
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

      const res = await accept(carol, trade.id);

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

      const res = await api().post(`/trades/${trade.id}/accept`);

      expect(res.status).toBe(401);
      expect(await allHoldings()).toEqual(before);
      expect((await storedTrade(trade.id)).status).toBe("PENDING");
    });
  });

  describe("409 — already answered", () => {
    it("refuses a trade that was already accepted", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const first = await accept(bob, trade.id);
      expect(first.status).toBe(200);
      const afterFirst = await allHoldings();

      const second = await accept(bob, trade.id);

      expect(second.status).toBe(409);
      expect(second.body).toEqual({ error: ALREADY_ANSWERED });
      // The cards moved once, not twice — the status code alone would not
      // notice a second swap.
      expect(await allHoldings()).toEqual(afterFirst);
      expect((await storedTrade(trade.id)).status).toBe("ACCEPTED");
    });

    it("refuses a trade that was already declined", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const respondedAt = new Date();
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: "DECLINED", respondedAt },
      });
      const before = await allHoldings();

      const res = await accept(bob, trade.id);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: ALREADY_ANSWERED });
      expect(await allHoldings()).toEqual(before);
      const stored = await storedTrade(trade.id);
      // A declined trade stays declined, and keeps the moment it was declined.
      expect(stored.status).toBe("DECLINED");
      expect(stored.respondedAt!.getTime()).toBe(respondedAt.getTime());
    });
  });

  describe("404 — no such trade", () => {
    it("404s for an unknown id", async () => {
      const { bob } = await twoTraders();
      const before = await allHoldings();

      const res = await accept(bob, "no-such-trade");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: NOT_FOUND });
      expect(await allHoldings()).toEqual(before);
    });
  });

  describe("what the swap does to the giver's row", () => {
    it("leaves the row behind when the giver had a spare", async () => {
      const { alice, bob, dupe, bobOnly } = await twoTraders();
      expect(await copiesOf(alice.id, dupe.id)).toBe(2);
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: dupe.id,
        requestedCardId: bobOnly.id,
      });

      const res = await accept(bob, trade.id);

      expect(res.status).toBe(200);
      expect(await copiesOf(alice.id, dupe.id)).toBe(1);
      expect(await hasRowFor(alice.id, dupe.id)).toBe(true);
      expect(await copiesOf(bob.id, dupe.id)).toBe(1);
    });

    it("deletes the row when the last copy leaves, so the card reads unowned", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const res = await accept(bob, trade.id);
      expect(res.status).toBe(200);

      // A row sitting at zero would be invisible to a quantity assertion and
      // visible to every user: `GET /cards` computes `owned: !!uc`.
      expect(await hasRowFor(alice.id, aliceOnly.id)).toBe(false);
      expect(await hasRowFor(bob.id, bobOnly.id)).toBe(false);

      const list = await authedApi(alice, "get", "/cards");
      expect(list.status).toBe(200);
      const cards = list.body as Array<{ id: string; owned: boolean; quantity: number }>;
      const gone = cards.find((c) => c.id === aliceOnly.id)!;
      expect(gone.owned).toBe(false);
      expect(gone.quantity).toBe(0);
      // And the card she received reads as hers.
      const gained = cards.find((c) => c.id === bobOnly.id)!;
      expect(gained.owned).toBe(true);
      expect(gained.quantity).toBe(1);

      const detail = await authedApi(alice, "get", `/cards/${aliceOnly.id}`);
      expect(detail.body).toMatchObject({ owned: false, quantity: 0 });
    });

    it("increments the receiver's existing row rather than adding a second", async () => {
      const { alice, bob, common, bobOnly } = await twoTraders();
      // Both of them already hold `common`, so this is the case a `create`
      // would fail on: the (userId, cardId) unique constraint.
      expect(await copiesOf(bob.id, common.id)).toBe(1);
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: common.id,
        requestedCardId: bobOnly.id,
      });

      const res = await accept(bob, trade.id);

      expect(res.status).toBe(200);
      expect(await copiesOf(bob.id, common.id)).toBe(2);
      expect(await prisma.userCard.count({ where: { userId: bob.id, cardId: common.id } })).toBe(1);
      expect(await hasRowFor(alice.id, common.id)).toBe(false);
    });
  });

  describe("409 — the card is gone by the time it's accepted", () => {
    it("refuses when the sender traded the offered card away, and moves nothing", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      // Alice's only copy leaves after the offer was made — the case that
      // separates a swap that works from one that invents a card.
      await prisma.userCard.delete({
        where: { userId_cardId: { userId: alice.id, cardId: aliceOnly.id } },
      });
      const before = await allHoldings();

      const res = await accept(bob, trade.id);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: SENDER_LOST_IT });
      // Byte-identical, not merely "bob still has one": the claim, the
      // decrement and the upsert all have to have rolled back together.
      expect(await allHoldings()).toEqual(before);
      expect(await copiesOf(bob.id, bobOnly.id)).toBe(1);
      expect(await hasRowFor(alice.id, bobOnly.id)).toBe(false);
    });

    it("rolls the claim back too, leaving the trade pending and unanswered", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      await prisma.userCard.delete({
        where: { userId_cardId: { userId: alice.id, cardId: aliceOnly.id } },
      });

      const res = await accept(bob, trade.id);
      expect(res.status).toBe(409);

      // The claim runs before the card moves, so a transaction that isn't
      // really a transaction leaves an ACCEPTED trade with nothing swapped —
      // the worst possible outcome, and one no collection assertion would see.
      const stored = await storedTrade(trade.id);
      expect(stored.status).toBe("PENDING");
      expect(stored.respondedAt).toBeNull();
    });

    it("names the other side when it is the accepter who no longer has the card", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      await prisma.userCard.delete({
        where: { userId_cardId: { userId: bob.id, cardId: bobOnly.id } },
      });
      const before = await allHoldings();

      const res = await accept(bob, trade.id);

      // The two sides fail for opposite reasons and a recipient can act on the
      // difference — one is theirs to fix, the other isn't.
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: YOU_LOST_IT });
      expect(await allHoldings()).toEqual(before);
      expect((await storedTrade(trade.id)).status).toBe("PENDING");
      // Specifically: the first move already succeeded before the second one
      // failed, so this is the assertion that the first one came back.
      expect(await copiesOf(alice.id, aliceOnly.id)).toBe(1);
      expect(await hasRowFor(bob.id, aliceOnly.id)).toBe(false);
    });

    it("treats a row left at quantity zero as not owning the card", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      // Not a state the swap leaves behind — but if one ever exists it must not
      // be tradeable, and it must not go negative.
      await prisma.userCard.update({
        where: { userId_cardId: { userId: alice.id, cardId: aliceOnly.id } },
        data: { quantity: 0 },
      });
      const before = await allHoldings();

      const res = await accept(bob, trade.id);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: SENDER_LOST_IT });
      expect(await allHoldings()).toEqual(before);
      expect(await copiesOf(alice.id, aliceOnly.id)).toBe(0);
    });
  });

  describe("concurrency", () => {
    it("lets exactly one of two simultaneous accepts through, and swaps once", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      // Both in flight before either finishes. The loser contends on the Trade
      // row inside the claim — which is why the claim comes first: it blocks,
      // re-reads, and finds the row is no longer PENDING before it has touched
      // a single collection.
      const results = await Promise.all([accept(bob, trade.id), accept(bob, trade.id)]);

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body).toEqual({ error: ALREADY_ANSWERED });

      // The half that a status-code assertion cannot see. Two swaps would leave
      // alice holding two of bobOnly and bob two of aliceOnly.
      expect(await copiesOf(alice.id, aliceOnly.id)).toBe(0);
      expect(await copiesOf(bob.id, aliceOnly.id)).toBe(1);
      expect(await copiesOf(bob.id, bobOnly.id)).toBe(0);
      expect(await copiesOf(alice.id, bobOnly.id)).toBe(1);
      expect(await prisma.trade.count({ where: { status: "ACCEPTED" } })).toBe(1);
    });

    it("lets the copy be claimed once when three people are offered it", async () => {
      const season = await prisma.season.create({ data: { name: "Contended" } });
      const alice = await createUser("alice");
      // Sequential: createUser reads its counter after an await, so parallel
      // calls collide on the userIdNumber unique constraint.
      const bob = await createUser("bob");
      const carol = await createUser("carol");
      const dave = await createUser("dave");

      const prize = await prisma.card.create({
        data: { name: "Prize", seasonId: season.id, cardNumber: "01", rarity: "daycard" },
      });
      const backs = [];
      for (const [i, user] of [bob, carol, dave].entries()) {
        const card = await prisma.card.create({
          data: { name: `Back ${i}`, seasonId: season.id, cardNumber: `1${i}`, rarity: "daycard" },
        });
        await grant(user.id, card.id);
        backs.push({ user, card });
      }

      // One copy, three people told they can have it. All three offers are
      // legitimate at creation; only one can be legitimate at accept.
      await grant(alice.id, prize.id, 1);
      const trades = [];
      for (const { user, card } of backs) {
        trades.push(
          await pendingTrade({
            fromUserId: alice.id,
            toUserId: user.id,
            offeredCardId: prize.id,
            requestedCardId: card.id,
          })
        );
      }

      const first = await accept(backs[0].user, trades[0].id);
      expect(first.status).toBe(200);
      expect(await copiesOf(backs[0].user.id, prize.id)).toBe(1);
      expect(await hasRowFor(alice.id, prize.id)).toBe(false);

      const second = await accept(backs[1].user, trades[1].id);
      const third = await accept(backs[2].user, trades[2].id);

      // Both losers hear about alice's side, not their own: they still hold
      // what they offered, and it is the prize that is gone.
      expect(second.status).toBe(409);
      expect(second.body).toEqual({ error: SENDER_LOST_IT });
      expect(third.status).toBe(409);
      expect(third.body).toEqual({ error: SENDER_LOST_IT });
      expect(await copiesOf(backs[1].user.id, prize.id)).toBe(0);
      expect(await copiesOf(backs[2].user.id, prize.id)).toBe(0);

      // The losers keep what they offered — the swap is all or nothing, and
      // both halves of it rolled back.
      expect(await copiesOf(backs[1].user.id, backs[1].card.id)).toBe(1);
      expect(await copiesOf(backs[2].user.id, backs[2].card.id)).toBe(1);

      // And they are still PENDING, not auto-declined. Nothing a human did to
      // them, so `status` must not claim otherwise.
      expect((await storedTrade(trades[1].id)).status).toBe("PENDING");
      expect((await storedTrade(trades[2].id)).status).toBe("PENDING");
    });

    it("lets two of three through when the owner had two copies", async () => {
      const season = await prisma.season.create({ data: { name: "Contended" } });
      const alice = await createUser("alice");
      const bob = await createUser("bob");
      const carol = await createUser("carol");
      const dave = await createUser("dave");

      const prize = await prisma.card.create({
        data: { name: "Prize", seasonId: season.id, cardNumber: "01", rarity: "daycard" },
      });
      const backs = [];
      for (const [i, user] of [bob, carol, dave].entries()) {
        const card = await prisma.card.create({
          data: { name: `Back ${i}`, seasonId: season.id, cardNumber: `1${i}`, rarity: "daycard" },
        });
        await grant(user.id, card.id);
        backs.push({ user, card });
      }

      // Two copies, three offers. Two of them are genuinely fulfillable, which
      // is exactly why sibling trades are not invalidated on accept.
      await grant(alice.id, prize.id, 2);
      const trades = [];
      for (const { user, card } of backs) {
        trades.push(
          await pendingTrade({
            fromUserId: alice.id,
            toUserId: user.id,
            offeredCardId: prize.id,
            requestedCardId: card.id,
          })
        );
      }

      const results = [];
      for (const [i, trade] of trades.entries()) {
        results.push(await accept(backs[i].user, trade.id));
      }

      expect(results.map((r) => r.status)).toEqual([200, 200, 409]);
      expect(results[2].body).toEqual({ error: SENDER_LOST_IT });
      expect(await copiesOf(backs[0].user.id, prize.id)).toBe(1);
      expect(await copiesOf(backs[1].user.id, prize.id)).toBe(1);
      expect(await copiesOf(backs[2].user.id, prize.id)).toBe(0);
      expect(await hasRowFor(alice.id, prize.id)).toBe(false);
      // Alice received the first two backs and not the third.
      expect(await copiesOf(alice.id, backs[0].card.id)).toBe(1);
      expect(await copiesOf(alice.id, backs[1].card.id)).toBe(1);
      expect(await copiesOf(alice.id, backs[2].card.id)).toBe(0);
    });
  });

  describe("the async boundary", () => {
    it("turns a rejected query into a JSON 500 and keeps serving", async () => {
      const { bob } = await twoTraders();

      // A null byte is refused by Postgres inside a `text` value — `22021` —
      // whatever the query around it. On a plain express.Router() that
      // rejection is unhandled and Node 20 exits, taking the API down for
      // everybody; here it has to come back as a 500.
      const res = await accept(bob, "a%00b");

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
