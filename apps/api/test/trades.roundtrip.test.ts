import { beforeEach, describe, expect, it } from "vitest";
import type { Trade } from "@turnapp/shared";
import {
  authedApi,
  copiesOf,
  resetDatabase,
  totalCopiesEverywhere,
  twoTraders,
} from "./helpers";

/**
 * One trade, start to finish, over HTTP only.
 *
 * Every endpoint already has a suite of its own, and each of them reaches the
 * states it needs by writing rows with Prisma — deliberately, so a broken
 * `POST /trades` fails one file rather than four. The cost of that is that no
 * test anywhere asserts the endpoints agree with *each other*: that the id
 * `POST /trades` returns is the one the board lists and the one accept answers
 * to, that the board's `direction` flips for the two parties looking at the row
 * create wrote, that accepting is visible in `GET /cards` for both people.
 *
 * So this file writes nothing directly. Every state transition and every
 * observation goes through the API, in the order the mobile app performs them:
 * offer, both boards, accept, both collections, both boards again. It is the
 * one case that fails if the four surfaces drift apart while each stays
 * internally consistent.
 *
 * It asserts breadth rather than depth — the edge cases belong to the suites
 * that own each endpoint, and duplicating them here would mean two places to
 * update for one change.
 */

/** The caller's board, as the API serves it. */
async function boardOf(user: { id: string; isAdmin: boolean }): Promise<Trade[]> {
  const res = await authedApi(user, "get", "/trades");
  expect(res.status).toBe(200);
  return res.body as Trade[];
}

/** One card as it reads in a user's own collection. */
async function cardInCollection(
  user: { id: string; isAdmin: boolean },
  cardId: string
): Promise<{ owned: boolean; quantity: number }> {
  const res = await authedApi(user, "get", "/cards");
  expect(res.status).toBe(200);
  const cards = res.body as Array<{ id: string; owned: boolean; quantity: number }>;
  const card = cards.find((c) => c.id === cardId);
  expect(card).toBeDefined();
  return { owned: card!.owned, quantity: card!.quantity };
}

describe("a trade from offer to swap, over the API only", () => {
  beforeEach(resetDatabase);

  it("creates, shows on both boards, accepts, and moves both collections", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const before = await totalCopiesEverywhere();

    // 1. Alice offers her card for bob's.
    const created = await authedApi(alice, "post", "/trades").send({
      toUserId: bob.id,
      offeredCardId: aliceOnly.id,
      requestedCardId: bobOnly.id,
    });
    expect(created.status).toBe(201);
    const tradeId = (created.body as Trade).id;

    // 2. Both boards show it pending and fulfillable, described from each
    //    viewer's own side. `direction` is the only field that may differ:
    //    the row is stored sender-relative, so a board that reported "sent" to
    //    both of them would have the recipient offering their own card.
    const aliceBoard = await boardOf(alice);
    expect(aliceBoard).toHaveLength(1);
    expect(aliceBoard[0]).toMatchObject({
      id: tradeId,
      status: "PENDING",
      direction: "sent",
      fulfillable: true,
      respondedAt: null,
    });

    const bobBoard = await boardOf(bob);
    expect(bobBoard).toHaveLength(1);
    expect(bobBoard[0]).toMatchObject({
      id: tradeId,
      status: "PENDING",
      direction: "received",
      fulfillable: true,
      respondedAt: null,
    });

    // The cards themselves read identically to both of them — only the
    // direction is relative, and a client derives give/get from that alone.
    expect(aliceBoard[0].offeredCard.id).toBe(aliceOnly.id);
    expect(bobBoard[0].offeredCard.id).toBe(aliceOnly.id);
    expect(aliceBoard[0].requestedCard.id).toBe(bobOnly.id);
    expect(bobBoard[0].requestedCard.id).toBe(bobOnly.id);

    // 3. Nothing has moved yet. An offer is a promise, not a transfer.
    expect(await cardInCollection(alice, aliceOnly.id)).toEqual({ owned: true, quantity: 1 });
    expect(await cardInCollection(bob, bobOnly.id)).toEqual({ owned: true, quantity: 1 });
    expect(await totalCopiesEverywhere()).toBe(before);

    // 4. Bob accepts.
    const accepted = await authedApi(bob, "post", `/trades/${tradeId}/accept`);
    expect(accepted.status).toBe(200);
    expect((accepted.body as Trade).status).toBe("ACCEPTED");

    // 5. Both collections reflect the swap, as each user's own client sees it.
    //    `owned` is what the collectibles screen renders, and it is computed
    //    from the row existing — so the card each of them gave away has to be
    //    gone from the table, not sitting at zero.
    expect(await cardInCollection(alice, aliceOnly.id)).toEqual({ owned: false, quantity: 0 });
    expect(await cardInCollection(alice, bobOnly.id)).toEqual({ owned: true, quantity: 1 });
    expect(await cardInCollection(bob, bobOnly.id)).toEqual({ owned: false, quantity: 0 });
    expect(await cardInCollection(bob, aliceOnly.id)).toEqual({ owned: true, quantity: 1 });

    // The other user's collection, which is what the trade wizard's step 3
    // reads, agrees with their own view of it.
    const alicesCards = await authedApi(bob, "get", `/users/${alice.id}/cards`);
    expect(alicesCards.status).toBe(200);
    const alicesIds = (alicesCards.body as Array<{ id: string }>).map((c) => c.id);
    expect(alicesIds).toContain(bobOnly.id);
    expect(alicesIds).not.toContain(aliceOnly.id);

    // Two copies moved, none appeared or vanished.
    expect(await totalCopiesEverywhere()).toBe(before);
    expect(await copiesOf(alice.id, bobOnly.id)).toBe(1);
    expect(await copiesOf(bob.id, aliceOnly.id)).toBe(1);

    // 6. Both boards now read accepted, with no fulfillability left to state.
    //    `false` here would render as "this one failed"; the trade succeeded.
    for (const [user, direction] of [
      [alice, "sent"],
      [bob, "received"],
    ] as const) {
      const board = await boardOf(user);
      expect(board).toHaveLength(1);
      expect(board[0]).toMatchObject({
        id: tradeId,
        status: "ACCEPTED",
        direction,
        fulfillable: null,
      });
      // The row is a permanent log, so the answer is stamped rather than the
      // trade disappearing off the board.
      expect(board[0].respondedAt).not.toBeNull();
    }
  });

  it("creates, declines, and leaves both collections exactly as they were", async () => {
    const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
    const before = await totalCopiesEverywhere();

    const created = await authedApi(alice, "post", "/trades").send({
      toUserId: bob.id,
      offeredCardId: aliceOnly.id,
      requestedCardId: bobOnly.id,
    });
    expect(created.status).toBe(201);
    const tradeId = (created.body as Trade).id;

    const declined = await authedApi(bob, "post", `/trades/${tradeId}/decline`);
    expect(declined.status).toBe(200);

    // Acceptance criterion 7: a declined trade still reads as declined on both
    // boards. Deleting the row on completion would satisfy every other
    // assertion in this file and fail this one.
    for (const [user, direction] of [
      [alice, "sent"],
      [bob, "received"],
    ] as const) {
      const board = await boardOf(user);
      expect(board).toHaveLength(1);
      expect(board[0]).toMatchObject({
        id: tradeId,
        status: "DECLINED",
        direction,
        fulfillable: null,
      });
    }

    expect(await cardInCollection(alice, aliceOnly.id)).toEqual({ owned: true, quantity: 1 });
    expect(await cardInCollection(bob, bobOnly.id)).toEqual({ owned: true, quantity: 1 });
    expect(await cardInCollection(alice, bobOnly.id)).toEqual({ owned: false, quantity: 0 });
    expect(await cardInCollection(bob, aliceOnly.id)).toEqual({ owned: false, quantity: 0 });
    expect(await totalCopiesEverywhere()).toBe(before);
  });
});
