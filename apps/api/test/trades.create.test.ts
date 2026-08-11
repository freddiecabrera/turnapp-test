import { beforeEach, describe, expect, it } from "vitest";
import type { Trade } from "@turnapp/shared";
import {
  api,
  authedApi,
  copiesOf,
  createUser,
  grant,
  inFlight,
  prisma,
  resetDatabase,
  totalCopiesEverywhere,
  twoTraders,
  waitForLockWaiters,
} from "./helpers";

/**
 * Creating a trade request, driven over HTTP so auth, routing, validation and
 * the serializer are all in the path.
 *
 * The interesting property of this endpoint is what it *doesn't* do: a request
 * is a promise, not a transfer, so every case here also has to hold that no
 * card moved.
 */

/** Anything that looks like an address or a bcrypt hash, anywhere in a body. */
function leaks(body: unknown): boolean {
  const json = JSON.stringify(body);
  return json.includes("@") || json.includes("$2");
}

/**
 * The exact string a duplicate offer gets, asserted as a literal rather than
 * imported from the route. It is user-facing copy — a test that imports the
 * constant would agree with any rewrite of it, including an accidental one.
 */
const DUPLICATE = "You've already sent this offer. Check your sent requests.";

function post(user: { id: string; isAdmin: boolean }, body: Record<string, unknown>) {
  return authedApi(user, "post", "/trades").send(body);
}

/** Every quantity that could possibly move, in one comparable object. */
async function holdings(userId: string, cardIds: string[]) {
  const out: Record<string, number> = {};
  for (const cardId of cardIds) out[cardId] = await copiesOf(userId, cardId);
  return out;
}

describe("POST /trades", () => {
  beforeEach(resetDatabase);

  describe("on success", () => {
    it("creates a pending trade, sent by the caller and fulfillable now", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();

      const res = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      expect(res.status).toBe(201);
      const trade = res.body as Trade;
      expect(trade.id).toEqual(expect.any(String));
      expect(trade.status).toBe("PENDING");
      expect(trade.direction).toBe("sent");
      // Not null. Both ownership checks passed on the way in, and null is the
      // client's signal that a trade has already been answered.
      expect(trade.fulfillable).toBe(true);
      expect(trade.fromUser).toEqual({
        id: alice.id,
        username: alice.username,
        userIdNumber: alice.userIdNumber,
      });
      expect(trade.toUser).toEqual({
        id: bob.id,
        username: bob.username,
        userIdNumber: bob.userIdNumber,
      });
      expect(trade.offeredCard.id).toBe(aliceOnly.id);
      expect(trade.requestedCard.id).toBe(bobOnly.id);
      expect(trade.respondedAt).toBeNull();
      expect(new Date(trade.createdAt).toISOString()).toBe(trade.createdAt);
    });

    it("reads as 'received' to the other party", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();

      const res = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      // The row is stored sender-relative; only the viewer decides direction.
      // Serialized for the sender here, so it must say "sent" — the recipient's
      // view of the same row is GET /trades' problem, not this endpoint's.
      expect((res.body as Trade).direction).toBe("sent");
      const stored = await prisma.trade.findUniqueOrThrow({
        where: { id: (res.body as Trade).id },
      });
      expect(stored.fromUserId).toBe(alice.id);
      expect(stored.toUserId).toBe(bob.id);
    });

    it("rewrites both card images to the relative /static/cards path", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();

      const res = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const trade = res.body as Trade;
      // The stored values are bare filenames; clients need the served path or
      // every image in the trading UI breaks on a physical device.
      expect(aliceOnly.imageUrl).toBeTruthy();
      expect(trade.offeredCard.imageUrl).toBe(`/static/cards/${aliceOnly.imageUrl}`);
      expect(trade.requestedCard.imageUrl).toBe(`/static/cards/${bobOnly.imageUrl}`);
    });

    it("stores exactly one PENDING row with no response recorded", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();

      await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      const rows = await prisma.trade.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
        status: "PENDING",
        respondedAt: null,
      });
    });

    it("moves no cards", async () => {
      const { alice, bob, common, aliceOnly, bobOnly, dupe } = await twoTraders();
      const cardIds = [common.id, aliceOnly.id, bobOnly.id, dupe.id];
      const before = {
        alice: await holdings(alice.id, cardIds),
        bob: await holdings(bob.id, cardIds),
      };

      const res = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      expect(res.status).toBe(201);

      // A request is a promise, not a transfer. Nothing moves until accept.
      expect(await holdings(alice.id, cardIds)).toEqual(before.alice);
      expect(await holdings(bob.id, cardIds)).toEqual(before.bob);
      expect(before.alice[aliceOnly.id]).toBe(1);
      expect(before.bob[bobOnly.id]).toBe(1);
    });

    it("takes the sender from the token even when the body names someone else", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();

      const res = await post(alice, {
        // A body trying to send a trade as bob. The token says alice.
        fromUserId: bob.id,
        userId: bob.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      expect(res.status).toBe(201);
      expect((res.body as Trade).fromUser.id).toBe(alice.id);
      expect((res.body as Trade).direction).toBe("sent");
      const stored = await prisma.trade.findUniqueOrThrow({
        where: { id: (res.body as Trade).id },
      });
      expect(stored.fromUserId).toBe(alice.id);
      expect(stored.toUserId).toBe(bob.id);
    });

    it("cannot be used to send a trade as somebody else", async () => {
      const { alice, bob, bobOnly, common } = await twoTraders();
      // A third party so the forged trade is between two other people — the
      // shape a self-trade check would not catch.
      const carol = await createUser("carol");
      await grant(carol.id, common.id);

      // Every field here is valid *for bob*: he owns bobOnly, carol owns
      // common. Trusting the body would create a trade bob never sent. Alice
      // owns neither side of it, so the ownership check is what fires.
      const res = await post(alice, {
        fromUserId: bob.id,
        toUserId: carol.id,
        offeredCardId: bobOnly.id,
        requestedCardId: common.id,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "You don't have that card to offer." });
      expect(await prisma.trade.count()).toBe(0);
    });

    /**
     * The duplicate check keys on four columns, and each of them has to be in
     * the key or the endpoint refuses trades that are legal.
     *
     * The case below this comment varies `offeredCardId`, and for a long time
     * it was the only one: dropping any of the other three from the `findFirst`
     * left the whole suite green while `POST /trades` started answering 409 to
     * offers DESIGN.md describes as valid. Each of the next three varies
     * exactly one column and holds everything else identical, so it fails if
     * and only if that column leaves the key.
     *
     * They go through the endpoint rather than `prisma.trade.create`, which is
     * what makes them cover the handler's check — the board and accept suites
     * seed rows directly, so the `findFirst` never sees those at all.
     */
    it("allows a second, different offer to the same person", async () => {
      const { alice, bob, aliceOnly, bobOnly, dupe } = await twoTraders();

      const first = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const second = await post(alice, {
        toUserId: bob.id,
        offeredCardId: dupe.id,
        requestedCardId: bobOnly.id,
      });

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(await prisma.trade.count()).toBe(2);
    });

    it("allows the same card to be offered for two different cards", async () => {
      const { alice, bob, common, aliceOnly, bobOnly } = await twoTraders();

      // Same sender, same recipient, same offered card — only the card being
      // asked for differs, and bob owns both of them. Two distinct offers:
      // "my aliceOnly for your bobOnly" and "my aliceOnly for your common".
      const first = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const second = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: common.id,
      });

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(await prisma.trade.count()).toBe(2);
    });

    it("allows the same offer to be made to two different people", async () => {
      const { alice, bob, common, aliceOnly } = await twoTraders();
      const carol = await createUser("carol");
      await grant(carol.id, common.id);

      // DESIGN.md's "offering one copy to four people": legal at creation, and
      // a race only the accept guard is entitled to settle. Refusing the second
      // one here would decide it in the wrong place.
      const toBob = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: common.id,
      });
      const toCarol = await post(alice, {
        toUserId: carol.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: common.id,
      });

      expect([toBob.status, toCarol.status]).toEqual([201, 201]);
      expect(await prisma.trade.count()).toBe(2);
    });

    it("allows two different people to make the same offer", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const dave = await createUser("dave");
      await grant(dave.id, aliceOnly.id);

      // Byte-identical offers apart from who is sending them. Bob now has two
      // people asking for his bobOnly and offering the same card for it, which
      // is the whole point of a trading board.
      const fromAlice = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      const fromDave = await post(dave, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      expect([fromAlice.status, fromDave.status]).toEqual([201, 201]);
      expect(await prisma.trade.count()).toBe(2);
    });

    it("allows the mirror offer from the other side", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();

      const sent = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      // Same two cards, opposite direction. The unique index is keyed on the
      // sender, so this is a distinct offer and both may stand.
      const mirrored = await post(bob, {
        toUserId: alice.id,
        offeredCardId: bobOnly.id,
        requestedCardId: aliceOnly.id,
      });

      expect([sent.status, mirrored.status]).toEqual([201, 201]);
      expect(await prisma.trade.count()).toBe(2);
    });
  });

  describe("400 — malformed request", () => {
    it("rejects a missing field, naming the one that's missing", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const full = {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      };

      const cases: Array<[keyof typeof full, string]> = [
        ["toUserId", "Choose someone to trade with."],
        ["offeredCardId", "Choose one of your cards to offer."],
        ["requestedCardId", "Choose a card to ask for."],
      ];

      for (const [field, error] of cases) {
        const body: Record<string, unknown> = { ...full };
        delete body[field];
        const res = await post(alice, body);
        expect(res.status, field).toBe(400);
        expect(res.body, field).toEqual({ error });
      }

      const empty = await post(alice, {});
      expect(empty.status).toBe(400);
      expect(empty.body).toEqual({ error: "Choose someone to trade with." });

      expect(await prisma.trade.count()).toBe(0);
    });

    it("rejects a non-string field rather than coercing it", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();

      // `String(null)` is "null", which is a perfectly valid id to go looking
      // for and would turn a malformed request into a 404.
      for (const bad of [null, 7, true, ["a"], { id: "x" }, "", "   "]) {
        const label = JSON.stringify(bad);
        const asUser = await post(alice, {
          toUserId: bad,
          offeredCardId: aliceOnly.id,
          requestedCardId: bobOnly.id,
        });
        expect(asUser.status, label).toBe(400);
        expect(asUser.body, label).toEqual({ error: "Choose someone to trade with." });

        const asCard = await post(alice, {
          toUserId: bob.id,
          offeredCardId: bad,
          requestedCardId: bobOnly.id,
        });
        expect(asCard.status, label).toBe(400);
        expect(asCard.body, label).toEqual({ error: "Choose one of your cards to offer." });
      }

      expect(await prisma.trade.count()).toBe(0);
    });

    /**
     * Postgres refuses `0x00` inside a `text` value — `22021` — so an id
     * carrying one cannot be looked up, only declined. Unguarded it reached the
     * driver and came back as a 500, while `GET /users/search` and
     * `GET /users/:id/cards` answered 400 to the same byte.
     *
     * The trailing case is the one that explains why it slipped through: every
     * id here is trimmed, and `.trim()` does not remove `\0` — it is not
     * whitespace — so a perfectly well-formed cuid with one appended passed
     * every check in the handler and failed at the database.
     */
    it("rejects a null byte in any of the three ids rather than 500ing", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const full = {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      };

      const cases: Array<[keyof typeof full, string]> = [
        ["toUserId", "Choose someone to trade with."],
        ["offeredCardId", "Choose one of your cards to offer."],
        ["requestedCardId", "Choose a card to ask for."],
      ];

      for (const [field, error] of cases) {
        const res = await post(alice, { ...full, [field]: "aa\u0000bb" });
        expect(res.status, field).toBe(400);
        expect(res.body, field).toEqual({ error });
      }

      const trailing = await post(alice, { ...full, toUserId: `${bob.id}\u0000` });
      expect(trailing.status).toBe(400);
      expect(trailing.body).toEqual({ error: "Choose someone to trade with." });

      expect(await prisma.trade.count()).toBe(0);

      // Refused at the edge means nothing reached the driver, and the request
      // that shows it is the next one: the same route still works, and the
      // process is still here to answer it.
      const after = await post(alice, full);
      expect(after.status).toBe(201);
    });
  });

  describe("400 — a trade that cannot make sense", () => {
    it("rejects trading with yourself", async () => {
      const { alice, aliceOnly, common } = await twoTraders();

      // Two different cards, both owned by alice, so nothing but the
      // self-trade rule can reject this.
      const res = await post(alice, {
        toUserId: alice.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: common.id,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "You can't trade with yourself." });
      expect(await prisma.trade.count()).toBe(0);
    });

    it("rejects offering and asking for the same card", async () => {
      const { alice, bob, common } = await twoTraders();

      // Both of them own `common`, so both ownership checks would pass — this
      // can only be rejected by the same-card rule.
      const res = await post(alice, {
        toUserId: bob.id,
        offeredCardId: common.id,
        requestedCardId: common.id,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "That's the same card on both sides. Pick a different one to ask for.",
      });
      expect(await prisma.trade.count()).toBe(0);
    });

    it("rejects offering a card the sender doesn't own", async () => {
      const { alice, bob, bobOnly, common } = await twoTraders();

      const res = await post(alice, {
        toUserId: bob.id,
        offeredCardId: bobOnly.id,
        requestedCardId: common.id,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "You don't have that card to offer." });
      expect(await prisma.trade.count()).toBe(0);
    });

    it("treats a sender's row at quantity zero as not owning it", async () => {
      const { alice, bob, common, bobOnly } = await twoTraders();
      // A stray zero row: not what the swap leaves behind, but if one exists it
      // must not be offerable.
      await prisma.userCard.update({
        where: { userId_cardId: { userId: alice.id, cardId: common.id } },
        data: { quantity: 0 },
      });

      const res = await post(alice, {
        toUserId: bob.id,
        offeredCardId: common.id,
        requestedCardId: bobOnly.id,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "You don't have that card to offer." });
    });

    it("rejects asking for a card the recipient doesn't own", async () => {
      const { alice, bob, common, aliceOnly } = await twoTraders();

      const res = await post(alice, {
        toUserId: bob.id,
        offeredCardId: common.id,
        requestedCardId: aliceOnly.id,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "They don't have the card you asked for." });
      expect(await prisma.trade.count()).toBe(0);
    });

    it("treats a recipient's row at quantity zero as not owning it", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      await prisma.userCard.update({
        where: { userId_cardId: { userId: bob.id, cardId: bobOnly.id } },
        data: { quantity: 0 },
      });

      const res = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "They don't have the card you asked for." });
    });
  });

  describe("404 — something named doesn't exist", () => {
    it("404s for an unknown recipient", async () => {
      const { alice, aliceOnly, bobOnly } = await twoTraders();

      const res = await post(alice, {
        toUserId: "no-such-user",
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "We couldn't find that person." });
      expect(await prisma.trade.count()).toBe(0);
    });

    it("404s for an unknown offered card", async () => {
      const { alice, bob, bobOnly } = await twoTraders();

      const res = await post(alice, {
        toUserId: bob.id,
        offeredCardId: "no-such-card",
        requestedCardId: bobOnly.id,
      });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "We couldn't find the card you're offering." });
      expect(await prisma.trade.count()).toBe(0);
    });

    it("404s for an unknown requested card", async () => {
      const { alice, bob, aliceOnly } = await twoTraders();

      const res = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: "no-such-card",
      });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "We couldn't find the card you asked for." });
      expect(await prisma.trade.count()).toBe(0);
    });
  });

  describe("409 — the same offer twice", () => {
    it("409s on an identical pending offer", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const body = {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      };

      const first = await post(alice, body);
      const second = await post(alice, body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
      expect(second.body).toEqual({ error: DUPLICATE });
      expect(await prisma.trade.count()).toBe(1);
    });

    it("allows the same offer again once the first was declined", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const body = {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      };

      const first = await post(alice, body);
      // The unique index is partial on PENDING precisely so a refusal isn't
      // permanent — a declined offer must be re-proposable later.
      await prisma.trade.update({
        where: { id: (first.body as Trade).id },
        data: { status: "DECLINED", respondedAt: new Date() },
      });

      const again = await post(alice, body);

      expect(again.status).toBe(201);
      expect((again.body as Trade).status).toBe("PENDING");
      expect((again.body as Trade).id).not.toBe((first.body as Trade).id);
      expect(await prisma.trade.count()).toBe(2);
      expect(await prisma.trade.count({ where: { status: "PENDING" } })).toBe(1);
    });

    it("answers the same 409 whichever of the two duplicate guards fires", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const body = {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      };

      // Renamed off "concurrent": `Promise.all` over two supertest requests
      // mostly runs them end to end, so this cannot promise the second request
      // was ever inside the first. It does not need to. The point is that the
      // rule is enforced twice — the handler's `findFirst` and the partial
      // unique index — and a caller must not be able to tell which one refused
      // them. The overlapping half, where the index is provably what rejects
      // it, is the case below.
      const before = await totalCopiesEverywhere();

      const results = await Promise.all([post(alice, body), post(alice, body)]);

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body).toEqual({ error: DUPLICATE });
      expect(await prisma.trade.count()).toBe(1);
      // An offer is a promise, not a transfer: neither the accepted request nor
      // the refused one may have moved a copy anywhere.
      expect(await totalCopiesEverywhere()).toBe(before);
    });

    it("answers 409, not 500, when the unique index is what rejects it", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const before = await totalCopiesEverywhere();

      // Force the race rather than hope for it. An identical PENDING row is
      // held uncommitted, so the handler's duplicate check — reading committed
      // data — sees nothing and proceeds to INSERT, where it blocks on the
      // partial unique index until this transaction commits and then loses.
      // That is the exact window the P2002 catch exists for.
      //
      // The readiness is polled, not slept. Two `sleep()`s used to stand in for
      // "the row has landed" and "the handler has reached its own insert", and
      // a slow enough machine would release the gate before the handler had
      // even run its `findFirst` — which then reads the *committed* duplicate
      // and answers 409 from the application check. Same assertion, wrong path,
      // no way to tell from the result. `waitForLockWaiters(1)` asserts the
      // handler is parked on a lock instead of guessing that it is: the only
      // thing it can be blocked on here is the index entry this transaction
      // holds.
      const holdingOpen = prisma.$transaction(
        async (tx) => {
          await tx.trade.create({
            data: {
              fromUserId: alice.id,
              toUserId: bob.id,
              offeredCardId: aliceOnly.id,
              requestedCardId: bobOnly.id,
            },
          });

          // `inFlight` adopts supertest's lazy thenable, which is what actually
          // dispatches the request — assigning it would leave it un-sent, and
          // then waiting for it to block would wait forever.
          const inflight = inFlight(
            post(alice, {
              toUserId: bob.id,
              offeredCardId: aliceOnly.id,
              requestedCardId: bobOnly.id,
            })
          );
          await waitForLockWaiters(1);
          // Wrapped, not returned bare. An `async` function resolves whatever
          // it returns, so `return inflight` would make this callback wait for
          // the very request that is waiting for it to commit — a deadlock
          // broken only by the test timing out.
          return { inflight };
        },
        { timeout: 20000, maxWait: 10000 }
      );

      // The transaction resolves as soon as the handler is provably blocked,
      // and resolving is what commits it — which is what releases the handler
      // into its P2002.
      const res = await (await holdingOpen).inflight;
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: DUPLICATE });
      expect(await prisma.trade.count()).toBe(1);
      expect(await totalCopiesEverywhere()).toBe(before);
    });
  });

  /**
   * The other half of that catch: what it says when the failure is *not* one it
   * recognises.
   *
   * `app.ts`'s error middleware argues at length for a fixed sentence and never
   * `err.message`, because a rejected Prisma query stringifies to the failing
   * call and an absolute path into the source tree. This handler answers its own
   * 500 rather than rethrowing, so that argument has to hold here too — and
   * until this case existed, nothing checked that it did. A handler returning
   * `String(e.message)`, or a 200 with an empty body, passed the whole suite.
   *
   * Reaching it needs a real database failure that is not `P2002`, which the
   * five checks above are quite good at preventing. A foreign key is the way in:
   * the recipient is deleted in a transaction that stays open, so every read the
   * handler makes still sees him — READ COMMITTED shows it the committed row —
   * and the first statement that has to take a lock on `User` is the INSERT's own
   * foreign-key check. It parks there until the delete commits, then fails with
   * `P2003` on a row that no longer exists.
   *
   * Same machinery as the P2002 case above, and the same reason for it: polling
   * for the blocked backend asserts the handler reached the insert, rather than
   * sleeping and hoping.
   */
  describe("500 — a failure the handler didn't plan for", () => {
    it("answers the fixed sentence, never the database's message", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();

      const holdingOpen = prisma.$transaction(
        async (tx) => {
          // Uncommitted. Cascades take his UserCard rows with him, so this also
          // proves the ownership reads saw the pre-delete snapshot: had they
          // seen the delete, the request would have 400d long before the insert.
          await tx.user.delete({ where: { id: bob.id } });

          const inflight = inFlight(
            post(alice, {
              toUserId: bob.id,
              offeredCardId: aliceOnly.id,
              requestedCardId: bobOnly.id,
            })
          );
          await waitForLockWaiters(1);
          return { inflight };
        },
        { timeout: 20000, maxWait: 10000 }
      );

      const res = await (await holdingOpen).inflight;

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Something went wrong sending that offer." });
      // Nothing derived from the error. A Prisma message carries the failing
      // query, the absolute path of the file that ran it, and the lines around
      // it — none of which a client is entitled to.
      expect(res.text).not.toContain("prisma.");
      expect(res.text).not.toContain("/Users/");
      expect(res.text).not.toContain("Invalid `");
      expect(res.text).not.toContain("Foreign key");

      // The insert is the statement that failed, so nothing may have landed.
      expect(await prisma.trade.count()).toBe(0);

      const health = await api().get("/health");
      expect(health.status).toBe(200);
    }, 20_000);
  });

  /**
   * The same three rules, asserted against the schema instead of the handler.
   *
   * DESIGN.md calls this belt and braces: the CHECK constraints and the partial
   * unique index are the guarantee, and the route's 400s and 409s are what turn
   * a violation into a sentence a person can read. Every case above goes
   * through `POST /trades`, which means every one of them passes just as
   * happily if the constraints were never applied — the handler would refuse
   * first and nothing would reach the database to be refused.
   *
   * So these write with Prisma directly, bypassing the route. `harness.test.ts`
   * already asserts the three objects exist by name; what it cannot say is
   * whether they *do* anything, and a CHECK on the wrong expression is a
   * constraint that exists and permits everything.
   *
   * Prisma surfaces the two failures differently, which is itself worth
   * pinning: a CHECK violation has no Prisma error code at all — it arrives as
   * a `PrismaClientUnknownRequestError` whose message carries the constraint
   * name — while the unique index is a `P2002` with the four columns in
   * `meta.target`. The route's duplicate handler branches on that `P2002`, so
   * the shape is load-bearing rather than incidental.
   */
  describe("the constraints underneath the API", () => {
    it("refuses a self-trade at the database, not only in the handler", async () => {
      const { alice, aliceOnly, bobOnly } = await twoTraders();

      await expect(
        prisma.trade.create({
          data: {
            fromUserId: alice.id,
            toUserId: alice.id,
            offeredCardId: aliceOnly.id,
            requestedCardId: bobOnly.id,
          },
        })
      ).rejects.toThrow(/Trade_no_self_trade/);

      expect(await prisma.trade.count()).toBe(0);
    });

    it("refuses the same card on both sides at the database", async () => {
      const { alice, bob, aliceOnly } = await twoTraders();

      await expect(
        prisma.trade.create({
          data: {
            fromUserId: alice.id,
            toUserId: bob.id,
            offeredCardId: aliceOnly.id,
            requestedCardId: aliceOnly.id,
          },
        })
      ).rejects.toThrow(/Trade_distinct_cards/);

      expect(await prisma.trade.count()).toBe(0);
    });

    it("refuses a second pending row for the same offer at the database", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const offer = {
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      };
      await prisma.trade.create({ data: offer });

      // P2002 with all four columns named — the shape the route's catch reads
      // to turn this into the same 409 its own `findFirst` would have given.
      await expect(prisma.trade.create({ data: offer })).rejects.toMatchObject({
        code: "P2002",
        meta: {
          target: ["fromUserId", "toUserId", "offeredCardId", "requestedCardId"],
        },
      });

      expect(await prisma.trade.count()).toBe(1);
    });

    it("lets the same offer be inserted again once the first is answered", async () => {
      const { alice, bob, aliceOnly, bobOnly } = await twoTraders();
      const offer = {
        fromUserId: alice.id,
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      };
      const first = await prisma.trade.create({ data: offer });

      // The index is `WHERE status = 'PENDING'`, so answering the first one
      // takes it out of the index rather than out of the table. A total unique
      // index would pass every other test in this file and make a refused offer
      // permanently unrepeatable, which is the opposite of what a decline
      // means. Both statuses are checked because both leave PENDING.
      await prisma.trade.update({
        where: { id: first.id },
        data: { status: "DECLINED", respondedAt: new Date() },
      });
      const second = await prisma.trade.create({ data: offer });

      await prisma.trade.update({
        where: { id: second.id },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      await prisma.trade.create({ data: offer });

      expect(await prisma.trade.count()).toBe(3);
      expect(await prisma.trade.count({ where: { status: "PENDING" } })).toBe(1);
    });
  });

  describe("leaks and auth", () => {
    it("never returns an email address or a password hash", async () => {
      const { alice, bob, aliceOnly, bobOnly, common } = await twoTraders();

      const created = await post(alice, {
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });
      expect(created.status).toBe(201);
      expect(leaks(created.body)).toBe(false);
      expect(Object.keys((created.body as Trade).fromUser).sort()).toEqual([
        "id",
        "userIdNumber",
        "username",
      ]);
      expect(Object.keys((created.body as Trade).toUser).sort()).toEqual([
        "id",
        "userIdNumber",
        "username",
      ]);

      // Error paths return bodies too, and an error is where a stray record
      // most easily gets dumped.
      const rejected = await Promise.all([
        post(alice, {}),
        post(alice, { toUserId: alice.id, offeredCardId: aliceOnly.id, requestedCardId: common.id }),
        post(alice, { toUserId: "nope", offeredCardId: aliceOnly.id, requestedCardId: bobOnly.id }),
        post(alice, { toUserId: bob.id, offeredCardId: aliceOnly.id, requestedCardId: bobOnly.id }),
      ]);
      for (const res of rejected) expect(leaks(res.body)).toBe(false);
    });

    it("401s without a token", async () => {
      const { bob, aliceOnly, bobOnly } = await twoTraders();

      const res = await api().post("/trades").send({
        toUserId: bob.id,
        offeredCardId: aliceOnly.id,
        requestedCardId: bobOnly.id,
      });

      expect(res.status).toBe(401);
      expect(leaks(res.body)).toBe(false);
      expect(await prisma.trade.count()).toBe(0);
    });
  });
});
