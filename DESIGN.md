# Card trading — schema & API design

Design notes, written before implementation. The shipped write-up lives in `SOLUTION.md`.
Setup and environment quirks live in `AGENTS.md` — not restated here.

The guiding constraint: this repo already contains one complete vertical slice
(scan-to-collect), and `TAKE_HOME.md` scores "consistent with the existing codebase." Every
pattern below is lifted from `POST /scan` rather than invented.

**Status:** Decision 1 is locked. Decisions 2–4 have working answers marked below. Open
questions are listed at the end.

---

## Decision 1 — what does a trade reference? (locked)

A trade says "my card for your card." The question is what the row actually stores.

### The fact that decides it

**There are no individual card instances in this schema.** `UserCard` is
`@@unique([userId, cardId])` with a `quantity` int — one row per *(person, card type)* pair,
holding a count. A row reading `quantity: 3` is not three things; it is one row that says
"three."

So the intuitive model — a trade pointing at the specific card being traded — has nothing to
point at. That isn't a limitation to work around; it determines the whole design.

### Option A — reference `Card` plus the two user IDs *(chosen)*

Ownership becomes something the application asserts and verifies, not something a foreign key
guarantees.

### Option B — reference `UserCard` rows *(rejected)*

Fails three times, each worse than the last:

1. **It doesn't identify a copy.** Pointing at a row with `quantity: 3` doesn't say which of
   the three. The specificity is an illusion.
2. **The row dies at zero.** Trading away a last copy deletes it. `Cascade` destroys trade
   history; `Restrict` leaves zombie rows forever; `SetNull` is Option A with extra steps.
3. **Row identity isn't stable across the operation the trade describes.** After a swap, the
   card's new home has a different `UserCard.id` than the trade referenced — the receiver
   either got a new row or an increment to a pre-existing one. Worse, it's *nondeterministic*:
   if the sender happened to own two copies their row survives and the FK stays valid; if they
   owned one it dangles. Referential integrity that depends on how many copies someone
   happened to have is not integrity.

### Option B′ — composite FK to `UserCard(userId, cardId)` *(rejected, but instructive)*

`UserCard` has a compound unique, so this is expressible and Prisma validates it:

```prisma
offeredOwnership UserCard @relation(fields: [fromUserId, offeredCardId], references: [userId, cardId])
```

The database itself would then guarantee the sender owns what they're offering — no
application check needed. It still fails, for a reason worth stating precisely:

> **A foreign key expresses an invariant — true for the row's entire life. "The sender owns the
> offered card" is a precondition — true at creation, and specifically *supposed to become
> false* when the trade executes.**

On accept, moving the card either violates the constraint (`Restrict` blocks the very
operation the constraint exists to protect) or cascades (deleting the trade you just
completed). The constraint is correct at `t=create` and must be wrong at `t=accept`. Wrong
tool for the shape of the fact.

### Option C — restructure `UserCard` into per-copy instances *(right model, wrong scope)*

Drop `quantity`, one row per copy, no unique constraint. A trade then references a specific
instance and the swap is `UPDATE UserCard SET userId = ? WHERE id = ?` — atomic, obvious, no
decrement arithmetic, no delete-at-zero special case, provenance for free.

Not done here because **the blast radius is 11 source files across all four surfaces**:
`GET /cards`, `GET /cards/:id`, `POST /scan`, three admin endpoints, three shared DTOs,
`CardTile`, the card detail screen, the scan result screen, two admin pages — plus a data
migration expanding every existing row into N rows and a rewritten seed. `TAKE_HOME.md` says
to use existing patterns; refactoring the core ownership model with scan-to-collect downstream
of it is how you ship something broken.

**This is the top "with more time" item.**

### What Option A costs

Database-enforced ownership. With B′ the schema guarantees it; with A, correctness depends on
the application checking, every time, in the right places.

What buys it back: the guarded `updateMany` inside the accept transaction. The precondition
moves out of the schema and into the one place it can be enforced at the right moment —
atomically, at accept time, race-safe. The check isn't skipped, it's relocated to where a
precondition belongs.

---

## The schema

```prisma
enum TradeStatus {
  PENDING
  ACCEPTED
  DECLINED
}

/// A single-card-for-single-card trade request between two users.
/// Cards only move when the recipient accepts.
model Trade {
  id              String      @id @default(cuid())

  fromUser        User        @relation("TradesSent", fields: [fromUserId], references: [id], onDelete: Cascade)
  fromUserId      String
  toUser          User        @relation("TradesReceived", fields: [toUserId], references: [id], onDelete: Cascade)
  toUserId        String

  offeredCard     Card        @relation("TradesOffered", fields: [offeredCardId], references: [id], onDelete: Cascade)
  offeredCardId   String
  requestedCard   Card        @relation("TradesRequested", fields: [requestedCardId], references: [id], onDelete: Cascade)
  requestedCardId String

  status          TradeStatus @default(PENDING)

  createdAt       DateTime    @default(now())
  respondedAt     DateTime?

  @@index([toUserId, status])
  @@index([fromUserId, status])
}
```

Plus back-relations on `User` (`tradesSent`, `tradesReceived`) and `Card` (`tradesOffered`,
`tradesRequested`).

### Documented trade-offs in the above

**`Trade` is a permanent log, not a queue of active trades.** Rows are never deleted;
`status` separates live from historical. Acceptance criterion 7 requires a declined trade to
still show as declined on both boards — deleting on completion would fail it.

**Column names are sender-relative.** "Offered" always means *from `fromUser`*. Stable and
correct in the schema, but the same row reads inverted depending on the viewer, so no UI
element can be labelled "requested card" — it's wrong for half the users. Resolved at the
serializer, not the schema: `toPublicTrade(trade, viewerId)` emits `direction: "sent" |
"received"` and the client derives give/get from it in one line.

**`TradeStatus` is a native Postgres enum.** Adding a value later is `ALTER TYPE`, i.e. a
migration rather than a code change. Accepted because the three states are the shipped scope —
the fourth state we considered (`SUPERSEDED`) was resolved by deriving fulfillability at read
time instead, so there's no extensibility pressure to pay for.

**Two card columns, not a `TradeItem` join table.** One-for-one is the scoped requirement;
bundles are explicitly out of scope. The forward path is a real migration — new table, backfill
two rows per trade, drop the columns, rewrite every query — noted rather than pre-built.

**`onDelete: Cascade` on the card relations** means an admin deleting a card destroys every
trade that referenced it. Chosen for consistency: `UserCard.card` and `QrCode.card` both
cascade, so this is house style. The alternative for a real business record is snapshotting
`name` and `imageUrl` onto the trade at creation, the way an order line item snapshots a
product. Out of scope for a 48-hour review.

**No `quantity` on the trade.** One-for-one; a quantity column would imply an unbuilt feature.

**Indexes** match the board's only two queries: my incoming, my outgoing, filtered by status.

---

## The swap

`UserCard` is a count, not a set of rows, so "move a card" is a decrement on one side and an
upsert on the other.

**The trap:** `GET /cards` computes ownership as `owned: !!uc`. Leave a `quantity: 0` row
behind and the card still reads as owned. The giver's row must be deleted when the last copy
goes.

```ts
class TradeError extends Error {}

async function moveCard(
  tx: Prisma.TransactionClient,
  fromUserId: string,
  toUserId: string,
  cardId: string
) {
  // Take one copy, but only if the giver actually has one. A conditional
  // updateMany + count check is the guard POST /scan uses to claim a code.
  const taken = await tx.userCard.updateMany({
    where: { userId: fromUserId, cardId, quantity: { gte: 1 } },
    data: { quantity: { decrement: 1 } },
  });
  if (taken.count === 0) throw new TradeError("NOT_OWNED");

  // Drop the row when the last copy leaves, so `owned` flips to false.
  await tx.userCard.deleteMany({ where: { userId: fromUserId, cardId, quantity: { lte: 0 } } });

  // Give it to the receiver: increment, or create at 1.
  await tx.userCard.upsert({
    where: { userId_cardId: { userId: toUserId, cardId } },
    create: { userId: toUserId, cardId, quantity: 1 },
    update: { quantity: { increment: 1 } },
  });
}
```

### Accept

```ts
await prisma.$transaction(async (tx) => {
  // Claim first. Whoever flips PENDING wins; a second accept gets count 0.
  const claim = await tx.trade.updateMany({
    where: { id: trade.id, status: "PENDING" },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  if (claim.count === 0) throw new TradeError("ALREADY_ANSWERED");

  await moveCard(tx, trade.fromUserId, trade.toUserId, trade.offeredCardId);
  await moveCard(tx, trade.toUserId, trade.fromUserId, trade.requestedCardId);
});
```

Claiming **before** moving cards is what stops two concurrent accepts from both clearing the
ownership checks. Any throw rolls the whole transaction back, leaving the trade `PENDING` and
both collections untouched.

### Why the guard is sufficient

`POST /scan` establishes the idiom: put the precondition in the `where` of an `updateMany` and
check `count === 0`, rather than read-then-write. Under Postgres READ COMMITTED a concurrent
writer blocks on the row lock and then **re-evaluates the predicate** after it releases — so
`quantity: { gte: 1 }` cannot be beaten by a racing trade.

---

## Concurrency: many trades, one copy

Nothing stops several pending trades naming the same `(user, card)` pair, and nothing should.
Three people can each offer for your single copy of a card. All three are valid at creation.

Accepting the first makes the other two impossible — **but only if the quantity actually
reaches zero.** Owning two copies means two of the three can legitimately succeed. That is why
sibling trades are *not* auto-declined on accept: blanket invalidation would destroy valid
trades, and `DECLINED` would be a lie about what happened.

The mirror case is worse for UX: offering one copy to four people creates a race between four
strangers over a promise only one can receive. The systematic fix is **escrow** — decrement
the card out of the sender's collection at creation, hold it on the trade, release on accept or
return on decline. Out of scope because abandoned trades then lock cards forever, which needs
expiry, which `TAKE_HOME.md` excludes.

### Fulfillability is derived, not stored

Rather than materialising staleness with a fourth status and a write-side cascade, `GET /trades`
annotates each pending trade with whether it is still fulfillable — does the sender still own
what they offered, does the recipient still own what was requested. One extra query against
`UserCard`, no cascade, no trigger, and a derived value cannot itself go stale.

`status` then means only "what a human did," which is what a status column should mean.

---

## Edge cases and where they're caught

| Case | Where | Result |
| --- | --- | --- |
| Trading with yourself | create | 400 |
| Offering and requesting the same card | create | 400 |
| Offering a card you don't own | create | 400 |
| Requesting a card they don't own | create | 400 |
| Sender traded the card away before acceptance | accept, `moveCard` guard | 409, rolled back |
| Someone other than the recipient responds | accept/decline, authz check | 403 |
| Accepting an already-answered trade | accept, claim guard | 409 |
| Accepting your own sent trade | accept, authz check | 403 |
| Giver had 2 copies | `moveCard` | drops to 1, row survives |
| Giver had 1 copy | `moveCard` | row deleted, `owned` → false |
| Receiver already owned it | `upsert` | quantity increments |
| Two trades between the same pair, accepted at once | Postgres deadlock detection | one aborts → 409 |

The "sender traded it away" row is the one that separates a working submission from a correct
one, and it's why ownership is validated at accept rather than only at create.

**Mirror trades** (A offers X for Y while B offers Y for X) are legal, and accepting both
swaps the cards and then swaps them back. Not a bug — but it means "trade completed" does not
imply "state changed."

---

## API

Shapes follow the existing flat style (`/scan`, `/cards`, `/wallet`), and everything sits behind
`requireAuth` the way `appRouter` already does.

Split across two new routers rather than added to `routes/app.ts`. That file already carries
seasons, cards, scan and wallet in 143 lines; adding eight trading and user endpoints would have
roughly tripled it, and `routes/admin.ts` establishes that a separate router per concern is the
house style. So: `routes/users.ts` for the two user reads, `routes/trades.ts` for the trades.

Mount order matters. `appRouter` is mounted at `/` and applies `requireAuth` to everything that
reaches it, so a router mounted after it never sees its own requests. Both new routers mount
first.

Both new routers are built with `asyncRouter()` rather than `express.Router()`. Express 4 drops
a handler's returned promise on the floor, so a rejection inside an `async` route is an
unhandled rejection — which Node 20 turns into a process exit. `asyncRouter` wraps every handler
at registration so the rejection reaches the error middleware instead. It is not specific to
trading: the existing routers were switched to it too, because `GET /cards?seasonId=…` had the
same exposure.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/trades` | The board: every trade involving me, both directions |
| `POST` | `/trades` | Create a request |
| `POST` | `/trades/:id/accept` | Approve → swap |
| `POST` | `/trades/:id/decline` | Reject → nothing moves |
| `GET` | `/users/search?q=` | Wizard step 1: find someone to trade with |
| `GET` | `/users/:id/cards` | Wizard step 3: what they own, to pick from |

**Action endpoints over `PATCH /trades/:id { status }`.** Accept and decline aren't field
edits — they carry wildly different side effects and the same narrow authorization. Naming them
closes the state machine and makes the authz check impossible to miss.

**`fromUserId` always comes from the JWT, never the body.** Same for the accept/decline
identity check.

**`GET /users/search` returns `{ id, username, userIdNumber }` only.** The `User` model carries
`email` and `passwordHash`; a naive `findMany` leaks the address book.

**`GET /users/:id/cards` deliberately exposes another user's collection.** Step 3 requires it
and collections are public by nature in a trading app — stated as a product decision rather
than left implicit.

### Status codes

- **400** — validation: self-trade, same card both sides, missing fields, card not owned
- **403** — not the recipient, trying to respond
- **404** — trade, user, or card not found
- **409** — already answered, or ownership vanished between create and accept

Matches the existing `{ "error": "..." }` convention. `apps/mobile/src/api.ts` throws
`body.error` straight to the UI, so these strings are user-facing copy.

---

## Shared types

`packages/shared/src/index.ts`, mirrored into `apps/mobile/src/types.ts`:

```ts
export type TradeStatus = "PENDING" | "ACCEPTED" | "DECLINED";

/** A user as seen by someone else — no email, no internal fields. */
export interface UserSummary {
  id: string;
  username: string;
  userIdNumber: number;
}

export interface Trade {
  id: string;
  status: TradeStatus;
  /** Relative to the caller. "offered" is always from fromUser. */
  direction: "sent" | "received";
  /** Both sides still own their cards. null once accepted or declined. */
  fulfillable: boolean | null;
  fromUser: UserSummary;
  toUser: UserSummary;
  offeredCard: Card;
  requestedCard: Card;
  createdAt: string;
  respondedAt: string | null;
}

export interface CreateTradeRequest {
  toUserId: string;
  offeredCardId: string;
  requestedCardId: string;
}
```

Named `UserSummary` rather than `PublicUser` because the existing `toPublicUser` returns the
full `User` — including the email address — for the caller's own account and the admin views.
A `PublicUser` type sitting next to a `toPublicUser` that returns something larger is a trap.
`toUserSummary` is the one to reach for whenever one user is shown to another.

`fulfillable` is nullable rather than boolean: it's only meaningful while a trade is pending,
and reporting `false` on a completed trade would read as "this failed."

`GET /trades` returns a flat `Trade[]` ordered `createdAt desc` rather than
`{ sent: [], received: [] }` — one shape to maintain, and the board renders
all/incoming/outgoing by filtering locally, matching the pill pattern already on the
collectibles screen.

### Serializer

`toPublicTrade(trade, viewerId)` in `apps/api/src/serialize.ts`, alongside `toPublicCard` and
`toPublicQrCode`. **It must run both cards through `toPublicCard`** — that's what rewrites
`imageUrl` into the relative `/static/cards/...` path clients resolve against their own host.
Skip it and every card image in the trading UI silently breaks on a physical device.

---

## Resolved since first draft

**Delete the `UserCard` row at zero** rather than changing `GET /cards` to `owned: quantity > 0`.
Keeping zero-quantity rows would preserve `firstScannedAt`, but it needs `quantity > 0` filters
in four places across shipped endpoints — `GET /cards`, `GET /cards/:id`, the admin owners list
(where a zero row would appear as an "owner"), and the admin user-collection view. Changing read
semantics in someone else's codebase is the larger risk. The cost is real but small:
`firstScannedAt` is admin-only, rendered in exactly one column and used as one sort key, with no
mobile surface at all. Per-copy instance rows would preserve it properly, which is another point
for that follow-up.

**Guard duplicate pending trades at both levels.** A `findFirst` in the route for a readable
409, plus a partial unique index — `WHERE status = 'PENDING'` — appended as raw SQL to the
migration for the actual guarantee. Partial so a declined trade can still be re-proposed. The
same migration adds CHECK constraints for self-trade and same-card-both-sides: unlike ownership,
those are genuine invariants, so the database is the right place for them.

## Out of scope, one line each in `SOLUTION.md`

- **Per-copy `UserCard` instances** — the model this schema wants; 11 files across four surfaces.
- **Escrow / reservation** — the systematic fix for offering one copy to several people.
- **Push notifications** — `POST /trades` is the hook point. The board's pending-incoming count
  is the in-app stand-in the brief allows.
- **Deterministic lock order** — sorting the two `moveCard` calls by `cardId` would close the
  deadlock window between mirrored trades.
- **Bundles, points-in-trade, expiry, real-time, chat, admin trade management** — excluded by
  `TAKE_HOME.md`.
