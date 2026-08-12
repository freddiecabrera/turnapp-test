import { beforeEach, describe, expect, it } from "vitest";
import type { Trade } from "@turnapp/shared";
import {
  api,
  authedApi,
  createCard,
  createSeason,
  createUser,
  grant,
  prisma,
  resetDatabase,
  twoTraders,
} from "./helpers";

/**
 * The trading board — `GET /trades` — driven over HTTP so auth, routing and the
 * serializer are all in the path.
 *
 * Two things here are only observable from the outside, which is why they are
 * tested here rather than against a helper. `direction` is resolved against the
 * caller's token, so the same stored row has to come back reading differently
 * to the two parties; and the `where` clause is the endpoint's entire access
 * control — there is no trade id in the request to check an owner against — so
 * "somebody else's trade never appears" needs a third and fourth user in the
 * database, not a filtered array.
 *
 * `fulfillable` is derived per request rather than stored, so the cases below
 * change the world *after* the trade exists and re-read the board. That is the
 * property under test: a stored flag would still be reporting the answer that
 * was true at creation.
 *
 * Setup writes trades with Prisma rather than `POST /trades`. The create
 * endpoint has its own suite, and several states here — a trade whose sender
 * has since lost the card, three offers against two copies — cannot be reached
 * through it. Accept and decline are driven over HTTP, because "what the board
 * says after a trade is answered" is exactly the seam between them.
 */

/** Anything that looks like an address or a bcrypt hash, anywhere in a body. */
function leaks(body: unknown): boolean {
  const json = JSON.stringify(body);
  return json.includes("@") || json.includes("$2");
}

/** Every field `toPublicCard` emits, and no others — `Card` also has createdAt. */
const PUBLIC_CARD_KEYS = [
  "cardNumber",
  "id",
  "imageUrl",
  "name",
  "rarity",
  "rarityLevel",
  "seasonId",
  "story",
  "type",
  "universe",
];

function board(user: { id: string; isAdmin: boolean }) {
  return authedApi(user, "get", "/trades");
}

/** The board as a plain array, with the status code checked on the way through. */
async function boardOf(user: { id: string; isAdmin: boolean }): Promise<Trade[]> {
  const res = await board(user);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  return res.body as Trade[];
}

/** One trade off a board, by id, asserted to be there at all. */
function pick(trades: Trade[], id: string): Trade {
  const found = trades.find((t) => t.id === id);
  expect(found, `trade ${id} missing from the board`).toBeDefined();
  return found!;
}

async function pendingTrade(opts: {
  id?: string;
  fromUserId: string;
  toUserId: string;
  offeredCardId: string;
  requestedCardId: string;
  createdAt?: Date;
}) {
  return prisma.trade.create({ data: opts });
}

describe("GET /trades", () => {
  beforeEach(resetDatabase);

  describe("what it returns", () => {
    it("401s without a token", async () => {
      await twoTraders();

      const res = await api().get("/trades");

      expect(res.status).toBe(401);
      expect(res.body).not.toBeInstanceOf(Array);
    });

    it("returns an empty array for a user with no trades", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const loner = await createUser("loner");
      // Trades exist — just not theirs. An endpoint that returned everything
      // would pass an assertion made against an empty database.
      await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      expect(await boardOf(loner)).toEqual([]);
    });

    it("returns both directions, tagged relative to the caller", async () => {
      const { alice, bob, common, aliceOnly, bobOnly, dupe } = await twoTraders();
      const sent = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const received = await pendingTrade({
        fromUserId: bob.id,
        toUserId: alice.id,
        offeredCardId: common.id,
        requestedCardId: dupe.id,
      });

      const mine = await boardOf(alice);
      const theirs = await boardOf(bob);

      // Both rows reach both boards — one flat list, not an inbox.
      expect(mine.map((t) => t.id).sort()).toEqual([sent.id, received.id].sort());
      expect(theirs.map((t) => t.id).sort()).toEqual([sent.id, received.id].sort());

      // And the same stored row reads inverted for the two parties, which is
      // the whole reason `direction` is computed per viewer: the columns are
      // sender-relative, so `offeredCard` alone cannot tell a client which
      // card they are giving up.
      expect(pick(mine, sent.id).direction).toBe("sent");
      expect(pick(theirs, sent.id).direction).toBe("received");
      expect(pick(mine, received.id).direction).toBe("received");
      expect(pick(theirs, received.id).direction).toBe("sent");
    });

    it("serializes both parties and both cards, and leaks nothing", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const res = await board(alice);
      const row = pick(res.body as Trade[], trade.id);

      expect(row.fromUser).toEqual({
        id: alice.id,
        username: alice.username,
        userIdNumber: alice.userIdNumber,
      });
      expect(row.toUser).toEqual({
        id: bob.id,
        username: bob.username,
        userIdNumber: bob.userIdNumber,
      });

      // Exactly the public card shape. A raw Prisma card would carry
      // `createdAt` as well — and, more to the point, an absolute-free
      // `imageUrl` that breaks every image on a physical device.
      expect(Object.keys(row.offeredCard).sort()).toEqual(PUBLIC_CARD_KEYS);
      expect(Object.keys(row.requestedCard).sort()).toEqual(PUBLIC_CARD_KEYS);
      expect(row.offeredCard.id).toBe(aliceOnly.id);
      expect(row.requestedCard.id).toBe(bobOnly.id);
      expect(aliceOnly.imageUrl).toBeTruthy();
      expect(row.offeredCard.imageUrl).toBe(`/static/cards/${aliceOnly.imageUrl}`);
      expect(row.requestedCard.imageUrl).toBe(`/static/cards/${bobOnly.imageUrl}`);

      expect(row.createdAt).toBe(trade.createdAt.toISOString());
      expect(row.respondedAt).toBeNull();
      expect(leaks(res.body)).toBe(false);
    });
  });

  describe("other people's trades", () => {
    it("never returns a trade the caller is not part of", async () => {
      const { alice, bob, common, aliceOnly, bobOnly, dupe, season } = await twoTraders();
      const carol = await createUser("carol");
      const dave = await createUser("dave");
      const carolCard = await createCard(season.id, "Carol Card");
      const daveCard = await createCard(season.id, "Dave Card");
      await grant(carol.id, carolCard.id);
      await grant(dave.id, daveCard.id);

      const mine = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      // Two trades between two other people, in both directions, so a filter
      // that only checked one of `fromUserId`/`toUserId` would leak one of them.
      const strangers = await pendingTrade({
        fromUserId: carol.id,
        toUserId: dave.id,
        offeredCardId: carolCard.id,
        requestedCardId: daveCard.id,
      });
      const strangersBack = await pendingTrade({
        fromUserId: dave.id,
        toUserId: carol.id,
        offeredCardId: daveCard.id,
        requestedCardId: carolCard.id,
      });
      // And one between two other people that names cards alice owns — nothing
      // about the *cards* makes a trade hers.
      const aboutMyCards = await pendingTrade({
        fromUserId: carol.id,
        toUserId: dave.id,
        offeredCardId: common.id,
        requestedCardId: dupe.id,
      });

      const aliceBoard = await boardOf(alice);
      expect(aliceBoard.map((t) => t.id)).toEqual([mine.id]);

      const carolBoard = await boardOf(carol);
      expect(carolBoard.map((t) => t.id).sort()).toEqual(
        [strangers.id, strangersBack.id, aboutMyCards.id].sort()
      );
      expect(carolBoard.map((t) => t.id)).not.toContain(mine.id);

      // Four trades exist; nobody sees all four.
      expect(await prisma.trade.count()).toBe(4);
      expect(aliceBoard.length).toBe(1);
      expect(carolBoard.length).toBe(3);
    });
  });

  describe("ordering", () => {
    it("returns newest first", async () => {
      const { alice, bob, common, aliceOnly, bobOnly, dupe } = await twoTraders();

      // Insertion order deliberately disagrees with the expected order, so
      // dropping the `orderBy` gives the wrong answer rather than the right one
      // by accident: inserted middle, newest, oldest.
      const middle = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
        createdAt: new Date("2026-03-02T00:00:00.000Z"),
      });
      const newest = await pendingTrade({
        fromUserId: bob.id,
        toUserId: alice.id,
        offeredCardId: common.id,
        requestedCardId: dupe.id,
        createdAt: new Date("2026-03-03T00:00:00.000Z"),
      });
      const oldest = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: dupe.id,
        requestedCardId: common.id,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      });

      const ids = (await boardOf(alice)).map((t) => t.id);

      expect(ids).toEqual([newest.id, middle.id, oldest.id]);
      // Not the order they were written in, and not its reverse either.
      expect(ids).not.toEqual([middle.id, newest.id, oldest.id]);
      expect(ids).not.toEqual([oldest.id, middle.id, newest.id]);
      // Both parties see the same sequence; the sort is not viewer-dependent.
      expect((await boardOf(bob)).map((t) => t.id)).toEqual(ids);
    });

    it("puts an answered trade where its createdAt says, not its respondedAt", async () => {
      const { alice, bob, common, aliceOnly, bobOnly, dupe } = await twoTraders();
      const older = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      });
      const newer = await pendingTrade({
        fromUserId: bob.id,
        toUserId: alice.id,
        offeredCardId: common.id,
        requestedCardId: dupe.id,
        createdAt: new Date("2026-03-02T00:00:00.000Z"),
      });

      // Answering the older one stamps it with a respondedAt newer than either
      // createdAt. The board is a history of offers, so it must not jump.
      expect((await authedApi(bob, "post", `/trades/${older.id}/decline`)).status).toBe(200);

      expect((await boardOf(alice)).map((t) => t.id)).toEqual([newer.id, older.id]);
    });

    /**
     * The second sort key, which the two cases above cannot reach.
     *
     * Both of them place their trades a day apart, so `createdAt desc` decides
     * everything and `{ id: "desc" }` could be deleted without either noticing.
     * Ties are not the corner case that makes it worth having, either:
     * `createdAt` is `TIMESTAMP(3)` defaulting to `CURRENT_TIMESTAMP`, which is
     * *transaction start* truncated to the millisecond — inserting 120 trades
     * concurrently put 104 of them in one millisecond bucket. Without a
     * tiebreaker the order inside a bucket is whatever the plan produced, and
     * two identical requests can come back reshuffled, which is exactly what
     * the route's comment says the key is there to stop.
     *
     * The ids are written rather than generated, and the insertion order
     * deliberately disagrees with `id desc`. A cuid is random, so asserting
     * against generated ids would be asserting against a coin flip: the plan
     * for four rows returns them in physical order, which is insertion order,
     * which would match the expected order about one run in twenty-four.
     */
    it("breaks a createdAt tie by id, descending", async () => {
      const { alice, bob, common, aliceOnly, bobOnly, dupe } = await twoTraders();
      // One timestamp, shared byte for byte, so the first key cannot separate
      // any of these.
      const tied = new Date("2026-03-02T00:00:00.000Z");

      const written = [
        { id: "t2", offeredCardId: aliceOnly.id, requestedCardId: bobOnly.id },
        { id: "t4", offeredCardId: aliceOnly.id, requestedCardId: common.id },
        { id: "t1", offeredCardId: common.id, requestedCardId: bobOnly.id },
        { id: "t3", offeredCardId: dupe.id, requestedCardId: common.id },
      ];
      for (const row of written) {
        await pendingTrade({
          ...row,
          fromUserId: alice.id,
          toUserId: bob.id,
          createdAt: tied,
        });
      }

      const board = await boardOf(alice);

      // The premise, asserted rather than assumed: if these ever stopped tying,
      // the first key would be doing the sorting and this test would be
      // measuring nothing.
      expect(new Set(board.map((t) => t.createdAt)).size).toBe(1);

      expect(board.map((t) => t.id)).toEqual(["t4", "t3", "t2", "t1"]);
      // Not the order they were written in — dropping the tiebreaker returns
      // that instead.
      expect(board.map((t) => t.id)).not.toEqual(written.map((r) => r.id));

      // Total, not merely deterministic-looking: the same request twice, and
      // the other party's view of the same rows, all agree.
      expect((await boardOf(alice)).map((t) => t.id)).toEqual(["t4", "t3", "t2", "t1"]);
      expect((await boardOf(bob)).map((t) => t.id)).toEqual(["t4", "t3", "t2", "t1"]);
    });
  });

  describe("fulfillable", () => {
    it("is true while both sides still own their cards", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      // True for both of them: it describes the trade, not the viewer.
      expect(pick(await boardOf(alice), trade.id).fulfillable).toBe(true);
      expect(pick(await boardOf(bob), trade.id).fulfillable).toBe(true);
    });

    it("flips to false once the sender has traded the offered card away", async () => {
      const { alice, bob, aliceOnly, bobOnly, common } = await twoTraders();
      const offer = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      expect(pick(await boardOf(alice), offer.id).fulfillable).toBe(true);

      // Alice's only copy leaves through a real accepted trade, not a raw
      // delete: this is the situation the flag exists to describe.
      const elsewhere = await pendingTrade({
        fromUserId: bob.id,
        toUserId: alice.id,
        offeredCardId: common.id,
        requestedCardId: aliceOnly.id,
      });
      expect((await authedApi(alice, "post", `/trades/${elsewhere.id}/accept`)).status).toBe(200);

      // Same row, same request, different answer — because it is derived. A
      // stored flag would still be reporting what was true at creation, and
      // nothing writes to sibling trades on accept by design.
      expect(pick(await boardOf(alice), offer.id).fulfillable).toBe(false);
      expect(pick(await boardOf(bob), offer.id).fulfillable).toBe(false);
      // Still PENDING. Unfulfillable is not a status; nobody answered it.
      expect(pick(await boardOf(alice), offer.id).status).toBe("PENDING");
    });

    it("is false when the recipient no longer owns the requested card", async () => {
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

      // The other half of the check. Only testing the sender's side would pass
      // an implementation that never looked at the recipient at all.
      expect(pick(await boardOf(alice), trade.id).fulfillable).toBe(false);
      expect(pick(await boardOf(bob), trade.id).fulfillable).toBe(false);
    });

    it("is false when a row is left sitting at quantity zero", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const trade = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      // Not a state the swap leaves behind, but if one ever exists the board
      // must not promise a trade that accept would then refuse.
      await prisma.userCard.update({
        where: { userId_cardId: { userId: alice.id, cardId: aliceOnly.id } },
        data: { quantity: 0 },
      });

      expect(pick(await boardOf(alice), trade.id).fulfillable).toBe(false);
    });

    it("is null for an accepted trade and for a declined one", async () => {
      const { alice, bob, common, aliceOnly, bobOnly, dupe } = await twoTraders();
      const toAccept = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const toDecline = await pendingTrade({
        fromUserId: bob.id,
        toUserId: alice.id,
        offeredCardId: common.id,
        requestedCardId: dupe.id,
      });

      expect((await authedApi(bob, "post", `/trades/${toAccept.id}/accept`)).status).toBe(200);
      expect((await authedApi(alice, "post", `/trades/${toDecline.id}/decline`)).status).toBe(200);

      const mine = await boardOf(alice);

      // Null, not false. An answered trade has no fulfillability left to
      // describe, and false would read to a client as "this one failed" —
      // which is exactly the wrong thing to say about a completed swap.
      const accepted = pick(mine, toAccept.id);
      expect(accepted.status).toBe("ACCEPTED");
      expect(accepted.fulfillable).toBeNull();
      expect(accepted.respondedAt).not.toBeNull();

      const declined = pick(mine, toDecline.id);
      expect(declined.status).toBe("DECLINED");
      expect(declined.fulfillable).toBeNull();
      expect(declined.respondedAt).not.toBeNull();

      // And both are still on the board. `Trade` is a permanent log — a
      // declined trade has to keep reading as declined for both parties.
      expect(mine.length).toBe(2);
      expect((await boardOf(bob)).length).toBe(2);
    });

    it("keeps siblings fulfillable until the copies actually run out", async () => {
      // The case DESIGN.md uses to justify deriving this rather than storing
      // it: three offers against two copies. Accepting one invalidates nothing;
      // accepting the second invalidates the third.
      const season = await createSeason();
      const prize = await createCard(season.id, "Prize");
      const alice = await createUser("alice");
      const bob = await createUser("bob");
      const carol = await createUser("carol");
      const dave = await createUser("dave");
      await grant(alice.id, prize.id, 2);

      const offers: Array<{ user: { id: string; isAdmin: boolean }; trade: { id: string } }> = [];
      for (const [i, user] of [bob, carol, dave].entries()) {
        const back = await createCard(season.id, `Back ${i}`);
        await grant(user.id, back.id);
        offers.push({
          user,
          trade: await pendingTrade({
            fromUserId: alice.id,
            toUserId: user.id,
            offeredCardId: prize.id,
            requestedCardId: back.id,
          }),
        });
      }

      const fulfillabilityOnAlicesBoard = async () => {
        const rows = await boardOf(alice);
        return offers.map((o) => pick(rows, o.trade.id).fulfillable);
      };

      // Two copies, three offers: all three are legitimate right now, and the
      // board must not pre-emptively call any of them dead.
      expect(await fulfillabilityOnAlicesBoard()).toEqual([true, true, true]);

      expect(
        (await authedApi(offers[0].user, "post", `/trades/${offers[0].trade.id}/accept`)).status
      ).toBe(200);
      // One copy left, so the other two are still genuinely possible. This is
      // the assertion a write-side cascade would fail — blanket invalidation
      // would have killed two valid trades here.
      expect(await fulfillabilityOnAlicesBoard()).toEqual([null, true, true]);

      expect(
        (await authedApi(offers[1].user, "post", `/trades/${offers[1].trade.id}/accept`)).status
      ).toBe(200);
      // Now the copies are gone and the last one flips, with nothing written
      // to it and its status untouched.
      expect(await fulfillabilityOnAlicesBoard()).toEqual([null, null, false]);
      const last = pick(await boardOf(alice), offers[2].trade.id);
      expect(last.status).toBe("PENDING");
      expect(last.respondedAt).toBeNull();
    });

    it("answers a board where several trades name the same pair", async () => {
      // Deduplicating the lookups must not lose any of them. Two recipients,
      // the same offered card, plus a third trade naming the same card the
      // other way round.
      const season = await createSeason();
      const shared = await createCard(season.id, "Shared");
      const wantedBack = await createCard(season.id, "Wanted Back");
      const alice = await createUser("alice");
      const bob = await createUser("bob");
      const carol = await createUser("carol");
      await grant(alice.id, shared.id, 1);
      await grant(bob.id, wantedBack.id, 1);
      await grant(carol.id, wantedBack.id, 1);

      const toBob = await pendingTrade({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: shared.id,
        requestedCardId: wantedBack.id,
      });
      const toCarol = await pendingTrade({
        fromUserId: alice.id,
        toUserId: carol.id,
        offeredCardId: shared.id,
        requestedCardId: wantedBack.id,
      });
      // Same (user, card) pairs, opposite roles: bob offers what alice wants.
      const fromBob = await pendingTrade({
        fromUserId: bob.id,
        toUserId: alice.id,
        offeredCardId: wantedBack.id,
        requestedCardId: shared.id,
      });

      const rows = await boardOf(alice);
      expect(rows.length).toBe(3);
      expect(pick(rows, toBob.id).fulfillable).toBe(true);
      expect(pick(rows, toCarol.id).fulfillable).toBe(true);
      expect(pick(rows, fromBob.id).fulfillable).toBe(true);

      // Take alice's only copy of `shared` out of play. Every trade that names
      // it — in either role — has to flip, and nothing else may.
      await prisma.userCard.delete({
        where: { userId_cardId: { userId: alice.id, cardId: shared.id } },
      });
      const after = await boardOf(alice);
      expect(pick(after, toBob.id).fulfillable).toBe(false);
      expect(pick(after, toCarol.id).fulfillable).toBe(false);
      expect(pick(after, fromBob.id).fulfillable).toBe(false);

      // Bob is party to two of these, and reads them the same way.
      const bobBoard = await boardOf(bob);
      expect(bobBoard.length).toBe(2);
      expect(pick(bobBoard, toBob.id).fulfillable).toBe(false);
      expect(pick(bobBoard, fromBob.id).fulfillable).toBe(false);
    });
  });
});
