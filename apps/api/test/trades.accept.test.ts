import { beforeEach, describe, expect, it } from "vitest";
import type { Trade } from "@turnapp/shared";
import {
  api,
  authedApi,
  copiesOf,
  createCard,
  createSeason,
  createUser,
  grant,
  hasRowFor,
  inFlight,
  prisma,
  resetDatabase,
  totalCopiesEverywhere,
  totalCopiesOf,
  twoTraders,
  waitForLockWaiters,
  withUserCardLocked,
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
    it("answers a repeated accept 409 and swaps once, whichever guard catches it", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const before = await totalCopiesEverywhere();

      // `Promise.all` over two supertest requests does not reliably overlap
      // them — measured on this suite they run end to end, one after the other,
      // most of the time — so this case is renamed to stop claiming a race it
      // cannot guarantee. It is still worth keeping, for the property it does
      // prove: whichever guard refuses the loser, the *answer* is the same.
      // The readable pre-transaction status check catches it when the first has
      // already committed; the in-transaction claim catches it when it hasn't.
      // Same 409, same sentence, one swap, in both. The case below this one is
      // where the claim is actually put under a second writer.
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
      // A swap relocates copies and creates none. Two swaps of the same trade
      // would leave this two higher, which no per-user count above can see
      // without somebody having predicted which pair of rows to look at.
      expect(await totalCopiesEverywhere()).toBe(before);
    });

    it("refuses a second accept that reached its claim while the first held it", async () => {
      const season = await createSeason();
      const mine = await createCard(season.id, "Mine");
      const yours = await createCard(season.id, "Yours");
      const alice = await createUser("alice");
      const bob = await createUser("bob");
      // Two copies each, so both ownership guards would clear a second swap and
      // the claim is the only thing that can refuse it. One copy each would let
      // `moveCard` take the credit for a refusal that isn't its to take.
      await grant(alice.id, mine.id, 2);
      await grant(bob.id, yours.id, 2);
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: mine.id,
        requestedCardId: yours.id,
      });
      const before = await totalCopiesEverywhere();

      const pending = await withUserCardLocked(alice.id, mine.id, async () => {
        // The first accept claims the trade and then parks inside `moveCard`,
        // holding the Trade row's lock with nothing committed.
        const winner = inFlight(accept(bob, trade.id));
        await waitForLockWaiters(1);
        // The second reads the trade as PENDING — the claim above is real but
        // uncommitted — so the pre-transaction check waves it through and its
        // own claim queues behind the first. That is the interleaving the
        // Promise.all case above reaches only when the schedule cooperates,
        // and it is the one the in-transaction claim exists for.
        const loser = inFlight(accept(bob, trade.id));
        await waitForLockWaiters(2);
        return { winner, loser };
      });
      const winner = await pending.winner;
      const loser = await pending.loser;

      expect(winner.status).toBe(200);
      expect(loser.status).toBe(409);
      expect(loser.body).toEqual({ error: ALREADY_ANSWERED });

      // One swap. Without the claim's count check the second transaction runs
      // straight on into the moves and does the whole thing again.
      expect(await copiesOf(alice.id, mine.id)).toBe(1);
      expect(await copiesOf(bob.id, mine.id)).toBe(1);
      expect(await copiesOf(bob.id, yours.id)).toBe(1);
      expect(await copiesOf(alice.id, yours.id)).toBe(1);
      expect(await prisma.trade.count({ where: { status: "ACCEPTED" } })).toBe(1);
      expect(await totalCopiesEverywhere()).toBe(before);
    });

    it("refuses the second of two trades queued on the same last copy", async () => {
      const season = await createSeason();
      const prize = await createCard(season.id, "Prize");
      const bobCard = await createCard(season.id, "Bob's");
      const carolCard = await createCard(season.id, "Carol's");
      const alice = await createUser("alice");
      const bob = await createUser("bob");
      const carol = await createUser("carol");

      // One copy, promised to two people. Both offers were legitimate when they
      // were made; only one can be legitimate now.
      await grant(alice.id, prize.id, 1);
      await grant(bob.id, bobCard.id, 1);
      await grant(carol.id, carolCard.id, 1);

      const toBob = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: prize.id,
        requestedCardId: bobCard.id,
      });
      const toCarol = await pendingTrade({
        fromUserId: alice.id,
        toUserId: carol.id,
        offeredCardId: prize.id,
        requestedCardId: carolCard.id,
      });
      const before = await totalCopiesEverywhere();

      // Two different Trade rows, so neither request can be short-circuited
      // before its transaction: both claims succeed, and the single copy they
      // are both reaching for is the only thing that can separate them. Under
      // `Promise.all` that contention happened only when the schedule felt like
      // it — most runs finished bob's request before carol's began, which tests
      // sequential re-verification, not two writers on one row. Locking the
      // contested `UserCard` makes the overlap the case rather than the hope.
      const pending = await withUserCardLocked(alice.id, prize.id, async () => {
        // Bob's accept claims its own trade and parks inside `moveCard`, on the
        // decrement of alice's only copy, with nothing committed.
        const first = inFlight(accept(bob, toBob.id));
        await waitForLockWaiters(1);
        // Carol's accept claims *its* trade — a different row, so nothing
        // blocks it — and queues behind bob on the copy. Postgres hands the row
        // to the waiters in the order they arrived, so bob wins and carol is
        // left re-evaluating `quantity: { gte: 1 }` against a row bob has
        // deleted. That count-zero check is what has to answer here; without it
        // carol's transaction runs on into the upsert and mints a second copy
        // of a card there was one of.
        const second = inFlight(accept(carol, toCarol.id));
        await waitForLockWaiters(2);
        return { first, second };
      });
      const bobRes = await pending.first;
      const carolRes = await pending.second;

      expect(bobRes.status).toBe(200);
      expect(carolRes.status).toBe(409);
      // The loser hears about alice's side, not their own: they still hold what
      // they offered, and it is the prize that is gone.
      expect(carolRes.body).toEqual({ error: SENDER_LOST_IT });

      // One copy before, one copy after. Per-user counts say where it went;
      // this says nothing was invented on the way.
      expect(await totalCopiesOf(prize.id)).toBe(1);
      expect(await copiesOf(bob.id, prize.id)).toBe(1);
      expect(await copiesOf(carol.id, prize.id)).toBe(0);
      expect(await hasRowFor(alice.id, prize.id)).toBe(false);

      // Carol's half of the swap unwound with it, and her trade is still
      // pending — nothing a human did to it.
      expect(await copiesOf(carol.id, carolCard.id)).toBe(1);
      expect(await copiesOf(alice.id, carolCard.id)).toBe(0);
      expect(await copiesOf(alice.id, bobCard.id)).toBe(1);
      expect((await storedTrade(toBob.id)).status).toBe("ACCEPTED");
      expect((await storedTrade(toCarol.id)).status).toBe("PENDING");
      // Carol's transaction rolled back whole, so nothing it touched survives
      // in either direction — including the increment it had not reached.
      expect(await totalCopiesEverywhere()).toBe(before);
    });

    it("refuses the second of two trades queued on the accepter's own last copy", async () => {
      const season = await createSeason();
      const alicePrize = await createCard(season.id, "Alice's Prize");
      const carolPrize = await createCard(season.id, "Carol's Prize");
      const bobCard = await createCard(season.id, "Bob's");
      const alice = await createUser("alice");
      const bob = await createUser("bob");
      const carol = await createUser("carol");

      // The case above turned inside out. There, one sender's copy was
      // contended by two accepters; here one *accepter's* copy is contended by
      // the two trades he is answering. Bob gives `requestedCard` in both, so
      // the same `moveCard` guard ought to cover him — but "ought to, by
      // symmetry" is how a copy got minted on this codebase once already, and
      // an argument is not a test. One copy of `bobCard`, promised twice.
      await grant(alice.id, alicePrize.id, 1);
      await grant(carol.id, carolPrize.id, 1);
      await grant(bob.id, bobCard.id, 1);

      const fromAlice = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: alicePrize.id,
        requestedCardId: bobCard.id,
      });
      const fromCarol = await pendingTrade({
        fromUserId: carol.id,
        toUserId: bob.id,
        offeredCardId: carolPrize.id,
        requestedCardId: bobCard.id,
      });
      const before = await totalCopiesEverywhere();

      // Which row to lock follows from the order `routes/trades.ts` writes in:
      // the Trade row first (the claim), then the *offered* card out of the
      // sender, and only then the requested card out of the accepter. So each
      // request gets through three rows the other one does not want — its own
      // trade, its own sender's prize, and bob's new row for that prize — and
      // arrives at bob's copy of `bobCard` having already done everything else.
      // That one row is the whole of the overlap, so it is the one to hold.
      //
      // **No deadlock is possible in this shape**, and the mirror block below
      // is the exact contrast. A cycle needs each transaction to be holding
      // something the other is waiting for; these two share exactly one row, so
      // whoever reaches it first is waiting on nothing and always finishes,
      // which frees it for the other. Mirror trades share *two* rows and take
      // them in opposite orders, which is why that case can answer 500 and this
      // one cannot — so a 500 here would be a finding, not an accepted outcome,
      // and the 409 below is asserted exactly rather than as one of two.
      const pending = await withUserCardLocked(bob.id, bobCard.id, async () => {
        // Alice's trade claims itself, moves her prize to bob, and parks on the
        // decrement of bob's only copy with nothing committed.
        const first = inFlight(accept(bob, fromAlice.id));
        await waitForLockWaiters(1);
        // Carol's trade does all of its own work — a different Trade row, a
        // different sender's prize, a different destination row — and none of
        // it blocks, so it too reaches bob's copy and queues behind alice's
        // there. Postgres hands the row to the waiters in the order they
        // arrived, so alice's wins and carol's is left re-evaluating
        // `quantity: { gte: 1 }` against a row the winner has deleted. That
        // count-zero check is the only thing standing here: without it carol's
        // transaction runs on into the upsert and mints a second copy of a card
        // bob only ever had one of.
        const second = inFlight(accept(bob, fromCarol.id));
        await waitForLockWaiters(2);
        return { first, second };
      });
      const aliceRes = await pending.first;
      const carolRes = await pending.second;

      expect(aliceRes.status).toBe(200);
      expect(carolRes.status).toBe(409);
      // The accepter's side, not the sender's. Both trades are addressed to
      // bob and it is bob's copy that ran out — telling him carol no longer has
      // what she offered would name the wrong person and point him at a
      // recovery that is not his to take.
      expect(carolRes.body).toEqual({ error: YOU_LOST_IT });

      // One copy before, one copy after, and it is alice who has it.
      expect(await totalCopiesOf(bobCard.id)).toBe(1);
      expect(await copiesOf(alice.id, bobCard.id)).toBe(1);
      expect(await copiesOf(carol.id, bobCard.id)).toBe(0);
      expect(await hasRowFor(bob.id, bobCard.id)).toBe(false);

      // Bob ends up with one of the two prizes, not both. The loser's first
      // `moveCard` had already succeeded before its second one failed, so this
      // is the pair that says the rollback reached back past the failure.
      expect(await copiesOf(bob.id, alicePrize.id)).toBe(1);
      expect(await hasRowFor(bob.id, carolPrize.id)).toBe(false);
      expect(await copiesOf(carol.id, carolPrize.id)).toBe(1);
      expect(await hasRowFor(alice.id, alicePrize.id)).toBe(false);

      // Carol's trade is still pending and unanswered — bob's second request
      // was refused, and a refusal is not something a human did to the offer.
      expect((await storedTrade(fromAlice.id)).status).toBe("ACCEPTED");
      const loser = await storedTrade(fromCarol.id);
      expect(loser.status).toBe("PENDING");
      expect(loser.respondedAt).toBeNull();

      // The assertion that did not have to predict the shape of the mistake.
      expect(await totalCopiesEverywhere()).toBe(before);
    });
  });

  /**
   * Mirror trades: alice offers X for Y while bob offers Y for X.
   *
   * Both are legal at creation — `POST /trades` has a case for that — and the
   * unique index does not touch them, because it keys on `(fromUserId,
   * toUserId, offeredCardId, requestedCardId)` and the two rows disagree on
   * every one of those columns. So the pair reaches accept intact, and the two
   * trades are then competing for the same two copies from opposite ends.
   *
   * **This contradicts DESIGN.md.** The edge-case section says accepting both
   * "swaps the cards and then swaps them back". It cannot: the offered card
   * always moves *from* `fromUser`, so once alice's accept has handed X to bob
   * and taken Y from him, bob no longer holds the Y his own trade offers, and
   * `moveCard`'s guard refuses the second accept with the 409 it refuses any
   * vanished card with. The cards are swapped exactly once and stay swapped.
   * Both tests below assert what actually happens; the design note is the thing
   * that is wrong, not the code, and the outcome it describes ("trade completed
   * does not imply state changed") never arises.
   */
  describe("mirror trades", () => {
    /** alice offers `aliceOnly` for `bobOnly`; bob offers `bobOnly` for `aliceOnly`. */
    async function mirrored() {
      const fixtures = await twoTraders();
      const { alice, bob, aliceOnly, bobOnly } = fixtures;
      const aliceOffers = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const bobOffers = await pendingTrade({
        fromUserId: bob.id,
        toUserId: alice.id,
        offeredCardId: bobOnly.id,
        requestedCardId: aliceOnly.id,
      });
      return { ...fixtures, aliceOffers, bobOffers };
    }

    it("refuses the second, whose offered card the first already moved", async () => {
      const { alice, bob, aliceOnly, bobOnly, aliceOffers, bobOffers } = await mirrored();
      const before = await totalCopiesEverywhere();

      const first = await accept(bob, aliceOffers.id);
      expect(first.status).toBe(200);

      // Bob's trade still offers `bobOnly`, which he handed to alice a moment
      // ago. Nothing marked it unfulfillable — sibling trades are deliberately
      // not cascaded — so it is the accept-time ownership check that catches
      // it, which is the entire reason ownership is re-verified here.
      const second = await accept(alice, bobOffers.id);
      expect(second.status).toBe(409);
      expect(second.body).toEqual({ error: SENDER_LOST_IT });

      // Swapped once and left swapped.
      expect(await copiesOf(alice.id, aliceOnly.id)).toBe(0);
      expect(await copiesOf(bob.id, aliceOnly.id)).toBe(1);
      expect(await copiesOf(bob.id, bobOnly.id)).toBe(0);
      expect(await copiesOf(alice.id, bobOnly.id)).toBe(1);
      expect(await totalCopiesEverywhere()).toBe(before);

      expect((await storedTrade(aliceOffers.id)).status).toBe("ACCEPTED");
      expect((await storedTrade(bobOffers.id)).status).toBe("PENDING");
    });

    it("reaches the same collections whichever mirror wins, and conserves every copy", async () => {
      // Not pinned, and not claiming to be: an ordering-independent invariant
      // is the only thing worth asserting here, because the orderings genuinely
      // differ in what they answer. Run unchoreographed, the two transactions
      // take the same two `UserCard` rows in opposite orders, so Postgres
      // sometimes resolves this by deadlock detection — DESIGN.md's edge-case
      // table has that row, and the aborted transaction surfaces as a 500
      // rather than a 409 because Prisma 5.22 does not map `40P01` to a code
      // the route could branch on. Measured over six runs it was a 500 four
      // times and a 409 twice.
      //
      // What does not vary: exactly one accept succeeds, and the cards end up
      // in the same place either way — the two trades describe the same swap
      // from opposite ends, so whichever commits produces the same collections.
      // A 500 that had half-applied a swap, or a deadlock loser that had
      // committed its decrement, would both land here.
      const { alice, bob, aliceOnly, bobOnly, aliceOffers, bobOffers } = await mirrored();
      const before = await totalCopiesEverywhere();

      const [fromAlice, fromBob] = await Promise.all([
        accept(bob, aliceOffers.id),
        accept(alice, bobOffers.id),
      ]);

      const statuses = [fromAlice.status, fromBob.status];
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      // The loser is refused, however Postgres got there. Both are honest
      // answers to "somebody else took that copy"; only the 409 is the one the
      // caller can act on, which is why DESIGN.md files the 500 as a defect in
      // what the loser is told rather than in what happened.
      expect([409, 500]).toContain(statuses.find((s) => s !== 200));

      expect(await copiesOf(alice.id, aliceOnly.id)).toBe(0);
      expect(await copiesOf(bob.id, aliceOnly.id)).toBe(1);
      expect(await copiesOf(bob.id, bobOnly.id)).toBe(0);
      expect(await copiesOf(alice.id, bobOnly.id)).toBe(1);
      expect(await totalCopiesEverywhere()).toBe(before);

      // Exactly one trade was answered; the refused one is still PENDING,
      // because nothing a human did to it.
      expect(await prisma.trade.count({ where: { status: "ACCEPTED" } })).toBe(1);
      expect(await prisma.trade.count({ where: { status: "PENDING" } })).toBe(1);
      // An explicit budget, like every other concurrency case in this file, and
      // for a sharper reason: on the deadlock path this test's duration is set
      // by Postgres's `deadlock_timeout`, not by anything it does. That defaults
      // to 1s — measured here at 1060–1079ms over eight runs, deadlocking 8/8 —
      // which sits just inside vitest's 5s default and outside it on any server
      // where the setting has been raised. Bounding it explicitly keeps a
      // database configuration change from failing a test about trade logic.
    }, 20_000);
  });

  /**
   * The same contention, answered one request at a time.
   *
   * Nothing here overlaps — each accept has finished before the next begins —
   * so these are tests of ownership being re-verified at accept time rather
   * than trusted from creation, which is a different property from the one the
   * block above measures. They lived under `concurrency` and were not.
   */
  describe("several open offers for one copy, answered in turn", () => {
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

  /**
   * A null byte is refused by Postgres inside a `text` value — `22021` —
   * whatever the query around it, so an id carrying one can only be declined.
   * This used to be the router's async-boundary case: unguarded, the rejection
   * reached the driver and came back as the error middleware's 500, which on a
   * plain `express.Router()` would instead have been an unhandled rejection and
   * a dead process.
   *
   * The guard moves the answer forward to where the input is classified, so the
   * assertion is now a 400 — matching `GET /users/:id/cards`, which has always
   * answered 400 to the same byte in the same position. The boundary itself is
   * unchanged and still covered, in `async-boundary.test.ts`.
   *
   * The health check stays. A refusal at the edge and a crash are told apart by
   * the next request, not by this one.
   */
  describe("a null byte in the id", () => {
    it("is refused with a 400 rather than reaching Postgres", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const res = await accept(bob, "a%00b");

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "That isn't a valid trade id." });
      // Nothing derived from an error: a Prisma message carries the failing
      // query and an absolute path into the source tree.
      expect(res.text).not.toContain("prisma.");
      expect(res.text).not.toContain("/Users/");

      // Refusing the id must not have touched the trade it doesn't name.
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).status).toBe(
        "PENDING"
      );

      const health = await api().get("/health");
      expect(health.status).toBe(200);

      // And a real id still works, so the guard rejects the byte rather than
      // the route.
      expect((await accept(bob, trade.id)).status).toBe(200);
    });
  });
});
