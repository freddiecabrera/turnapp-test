import { beforeEach, describe, expect, it } from "vitest";
import {
  authedApi,
  copiesOf,
  createCard,
  createQrCode,
  createSeason,
  createUser,
  grant,
  inFlight,
  prisma,
  resetDatabase,
  totalCopiesOf,
  waitForLockWaiters,
  withUserCardLocked,
} from "./helpers";

/**
 * `POST /scan` against a second writer of the same `UserCard` row.
 *
 * Scanning used to be the only thing that changed a quantity, so the worst a
 * race could do was lose an increment. Accepting a trade is the second writer,
 * and it moves a copy *between* people — so the same lost update stops
 * destroying a card and starts inventing one. Both are the same defect: a scan
 * that computes its new quantity from a value it read a moment earlier.
 *
 * Every case here pins the interleaving with `withUserCardLocked` rather than
 * firing two requests and hoping. Both requests are genuinely in flight in
 * their own transactions the whole time; what the lock decides is only *where*
 * each one parks, so the case that reproduces the bug is the case that runs,
 * every time, rather than 12 times in 12 and then not on the run that matters.
 */

function scan(user: { id: string; isAdmin: boolean }, code: string) {
  return authedApi(user, "post", "/scan").send({ code });
}

function accept(user: { id: string; isAdmin: boolean }, tradeId: string) {
  return authedApi(user, "post", `/trades/${tradeId}/accept`);
}

/** Alice, Bob, a card each of them can trade, and a QR code for the prize. */
async function tradeAndCode(aliceCopies: number) {
  const season = await createSeason();
  const prize = await createCard(season.id, "Prize");
  const back = await createCard(season.id, "Back");
  const alice = await createUser("alice");
  const bob = await createUser("bob");

  await grant(alice.id, prize.id, aliceCopies);
  await grant(bob.id, back.id, 1);

  const qr = await createQrCode(prize.id, "QR-PRIZE");
  const trade = await prisma.trade.create({
    data: {
      fromUserId: alice.id,
      toUserId: bob.id,
      offeredCardId: prize.id,
      requestedCardId: back.id,
    },
  });

  return { alice, bob, prize, back, qr, trade };
}

describe("POST /scan under concurrency", () => {
  beforeEach(resetDatabase);

  it("counts both of two simultaneous scans of the same card", async () => {
    const season = await createSeason();
    const card = await createCard(season.id, "Contended");
    const alice = await createUser("alice");
    await grant(alice.id, card.id, 1);
    const first = await createQrCode(card.id, "QR-ONE");
    const second = await createQrCode(card.id, "QR-TWO");

    // Two codes, so nothing serialises them but the row they both increment.
    const pending = await withUserCardLocked(alice.id, card.id, async () => {
      const a = inFlight(scan(alice, first.code));
      await waitForLockWaiters(1);
      // Reads the quantity the first scan also read — the first has claimed its
      // code and parked, and committed nothing.
      const b = inFlight(scan(alice, second.code));
      await waitForLockWaiters(2);
      return [a, b];
    });
    const [a, b] = await Promise.all(pending);

    expect([a.status, b.status]).toEqual([200, 200]);

    // Two codes collected, two copies. Computing the new quantity from the
    // earlier read makes the second write 2 over the first's 2.
    expect(await copiesOf(alice.id, card.id)).toBe(3);
    expect(await totalCopiesOf(card.id)).toBe(3);
    expect([a.body.card.quantity, b.body.card.quantity].sort()).toEqual([2, 3]);

    // One row, and both codes spent — a lost update that also lost a code
    // would be a different bug wearing the same total.
    expect(await prisma.userCard.count({ where: { userId: alice.id, cardId: card.id } })).toBe(1);
    expect(await prisma.qrCode.count({ where: { scannedAt: { not: null } } })).toBe(2);
  });

  it("mints exactly one copy when a scan lands on the row an accept is moving", async () => {
    const { alice, bob, prize, back, qr, trade } = await tradeAndCode(2);
    expect(await totalCopiesOf(prize.id)).toBe(2);

    const pending = await withUserCardLocked(alice.id, prize.id, async () => {
      // The accept claims the trade and parks inside `moveCard`, on the
      // decrement of alice's row.
      const accepted = inFlight(accept(bob, trade.id));
      await waitForLockWaiters(1);
      // The scan claims its code and reads alice's quantity — 2, because the
      // accept has committed nothing — then queues behind it.
      const scanned = inFlight(scan(alice, qr.code));
      await waitForLockWaiters(2);
      return { accepted, scanned };
    });
    const accepted = await pending.accepted;
    const scanned = await pending.scanned;

    expect(accepted.status).toBe(200);
    expect(scanned.status).toBe(200);

    // Two copies existed and the scan collected one more: three. Writing back
    // the read value plus one overwrote the accept's decrement — alice 3 and
    // bob 1, four copies of a card there were two of, with alice keeping the
    // one she traded away and bob receiving it too.
    expect(await totalCopiesOf(prize.id)).toBe(3);
    expect(await copiesOf(alice.id, prize.id)).toBe(2);
    expect(await copiesOf(bob.id, prize.id)).toBe(1);

    // The trade's other half is untouched by any of this.
    expect(await copiesOf(alice.id, back.id)).toBe(1);
    expect(await copiesOf(bob.id, back.id)).toBe(0);
  });

  it("collects the card when the accept deletes the row mid-scan", async () => {
    // The giver's last copy: `moveCard` deletes the row, so the scan's write
    // arrives at a row that no longer exists. Addressing it by id turned that
    // into a 500 for an honest user; by (userId, cardId) it is an insert.
    const { alice, bob, prize, qr, trade } = await tradeAndCode(1);
    expect(await totalCopiesOf(prize.id)).toBe(1);

    const pending = await withUserCardLocked(alice.id, prize.id, async () => {
      const accepted = inFlight(accept(bob, trade.id));
      await waitForLockWaiters(1);
      const scanned = inFlight(scan(alice, qr.code));
      await waitForLockWaiters(2);
      return { accepted, scanned };
    });
    const accepted = await pending.accepted;
    const scanned = await pending.scanned;

    expect(accepted.status).toBe(200);
    expect(scanned.status).toBe(200);
    expect(scanned.body.card.quantity).toBe(1);

    expect(await totalCopiesOf(prize.id)).toBe(2);
    expect(await copiesOf(alice.id, prize.id)).toBe(1);
    expect(await copiesOf(bob.id, prize.id)).toBe(1);

    // A 500 here rolled the whole scan back, which is data-safe and still
    // costs the user their code: it stayed unscanned and unusable.
    const stored = await prisma.qrCode.findUniqueOrThrow({ where: { code: qr.code } });
    expect(stored.scannedAt).not.toBeNull();
    expect(stored.scannedByUserId).toBe(alice.id);
  });

  it("conserves copies when the scan and the accept race unchoreographed", async () => {
    // No lock, no pinned ordering: whichever way the two land, the card count
    // may only move by the one copy the scan collected. This is the shape a
    // user hits — the cases above are that shape with the interleaving held
    // still so a regression cannot hide behind a lucky schedule.
    const { alice, bob, prize, qr, trade } = await tradeAndCode(2);
    const before = await totalCopiesOf(prize.id);

    const [accepted, scanned] = await Promise.all([
      accept(bob, trade.id),
      scan(alice, qr.code),
    ]);

    expect(accepted.status).toBe(200);
    expect(scanned.status).toBe(200);
    expect(await totalCopiesOf(prize.id)).toBe(before + 1);
    expect(await copiesOf(bob.id, prize.id)).toBe(1);
    expect(await copiesOf(alice.id, prize.id)).toBe(2);
  });
});
