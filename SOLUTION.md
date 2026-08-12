# Card trading — write-up

The design reasoning lives in [`DESIGN.md`](DESIGN.md), and the setup quirks in
[`AGENTS.md`](AGENTS.md). This is the front door: what exists, how to run it, and what I
decided along the way.

---

## What was built

Card trading down to the database: a `Trade` model with its migration, six endpoints behind
`requireAuth`, the shared DTOs, and 161 tests.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/trades` | the board — every trade I'm in, both directions |
| `POST` | `/trades` | offer one of my cards for one of yours |
| `POST` | `/trades/:id/accept` | approve → both cards swap, atomically |
| `POST` | `/trades/:id/decline` | refuse → nothing moves |
| `GET` | `/users/search?q=` | wizard step 1: find a partner |
| `GET` | `/users/:id/cards` | wizard step 3: what they own |

Cards move only when the recipient accepts, and only inside one transaction. `Trade` is a
permanent log rather than a queue of open offers, so a declined trade still reads as declined
on both boards.

**The mobile screens are not built.** The DTOs are mirrored into `apps/mobile/src/types.ts`
so the board and the create-trade wizard have their contract, but no UI consumes them yet.
That is the missing layer of the vertical slice and the first thing I'd build next.

---

## How to run and test it

From the repo root, on a fresh clone:

```bash
cp .env.example .env                # required first — the Prisma scripts read it
npm install                         # workspaces: packages/*, apps/api, apps/admin
npm --prefix apps/mobile install    # mobile is NOT a workspace, so it installs separately
npm run api:setup                   # docker postgres + prisma generate + migrate + seed
```

One command is the whole gate:

```bash
npm run verify   # api typecheck + mobile typecheck + admin build + 161 tests
```

The tests are integration tests against real Postgres, over HTTP with supertest, on a
database derived per checkout — see [`AGENTS.md`](AGENTS.md#verification). The risk in this
feature is transaction semantics, and a mocked Prisma client would only test the mock.

To exercise it by hand, with the API running (`npm run dev:api`):

```bash
T=$(curl -s -X POST localhost:4000/auth/login -H 'content-type: application/json' \
     -d '{"email":"testing@turn.app","password":"turn123"}' | jq -r .token)
curl -s "localhost:4000/users/search?q=100300" -H "Authorization: Bearer $T"   # the first seeded partner
curl -s localhost:4000/trades -H "Authorization: Bearer $T"
```

The seed gives its extra users random names and sequential ID numbers from `100300`, so search
by the number or list them first:

```bash
docker exec turnapp-db psql -U turn -d turnapp -c 'select email, username from "User";'
```

All eight share the password `turn123`, so a second account for the other side of a trade
needs no seed changes.

---

## Approach

_[TODO: a short personal statement — how I went about the work, in my own voice.]_

---

## Key decisions and trade-offs

**A trade references `Card`, not `UserCard`.** There are no per-copy rows in this schema:
`UserCard` is one row per (person, card) with a `quantity`. A trade pointing at "the copy
being traded" has nothing to point at. The cost is that ownership becomes something the
application asserts rather than something a foreign key guarantees — bought back by the
guarded `updateMany` inside the accept transaction, which is where a precondition belongs.
Three rejected alternatives, including a composite FK the database would enforce, are in
[`DESIGN.md`](DESIGN.md#decision-1--what-does-a-trade-reference-locked).

**Ownership is checked at accept, not only at create.** Between an offer and its approval,
either party can trade the card away. This is the case that separates a swap that works from
one that invents or destroys a collectible.

**Fulfillability is derived per request, not stored.** Several pending trades may name the
same copy, and accepting one only kills the others if the quantity actually reaches zero —
two of three stay valid if the owner had two. A stored flag would need a write-side cascade
that cannot know that. `status` then means only what a human did.

**Accept and decline are named actions, not `PATCH { status }`.** Same narrow authorization,
wildly different side effects. Naming them closes the state machine and makes the authz check
impossible to miss on one of them.

**Concurrency tests pin their interleaving with real row locks.** Two supertest requests
handed to `Promise.all` mostly run end to end, one after the other — so a race test built
that way agrees with an implementation missing the guard it names. Against a `moveCard`
rewritten as a read-then-write, the pinned version fails 4 runs in 4; the `Promise.all` version
it replaced went green on 1 run in 10 against that same broken guard. Every guard here was
checked by breaking it.

---

## What I found in the existing codebase

Four things, all pre-existing, all fixed on this branch.

**A collectible could be duplicated.** `POST /scan` read `UserCard.quantity` and wrote back
`existing.quantity + 1` — an absolute value from a stale read. Trading is the second writer of
that column, and it moves a copy *between* people, which flips the bug from destroying a copy
to minting one: a scan racing an accept left the giver holding the card she traded away and
the receiver holding it too. The write is now relative, the same upsert `moveCard` uses.

**The API exited on any unhandled promise rejection.** Express 4 doesn't route an `async`
handler's rejection to the error middleware, and Node 20 exits on unhandled rejections. A null
byte in a query string — which Postgres refuses inside a `text` value — took the whole process
down, from `GET /cards?seasonId=`, `POST /scan` or `POST /auth/login` alike. Fixed repo-wide
with `asyncRouter()`, which wraps handlers at registration so the boundary can't be forgotten
one route at a time.

**The error middleware then leaked internals.** With rejections finally arriving there, its
`err.message` became the disclosure: a rejected Prisma query stringifies to the failing call
and an absolute path into the source tree, and it was reachable with no token at all. It now
answers fixed text and logs the rest server-side.

**User search was enumerable.** Prisma's `contains` compiles to `ILIKE '%' || $1 || '%'` and
escapes nothing, so `?q=%` returned every non-admin user. `\`, `%` and `_` are now escaped —
which also makes a username with an underscore searchable.

---

## Connection to my evaluation of the live app

_[TODO: connect this work to the turn app evaluation I wrote. Three findings filed there are
the same failures this feature is graded on: cards in active trades staying redeemable (a
possible double-spend), a counter-offer flow that allowed same-card counters and unlimited
duplicate submissions, and a trade vault listing every card in existence rather than the ones
actually available.]_

---

## What I'd do with more time

- **The mobile screens** — the board and the create-trade wizard. The contract is already
  mirrored into `apps/mobile/src/types.ts`.
- **Per-copy `UserCard` rows.** The model this schema wants: a swap becomes
  `UPDATE UserCard SET userId = ?`, with no decrement arithmetic and no delete-at-zero. It's
  11 files across four surfaces plus a data migration, which is why it isn't here.
- **Deterministic lock order** — sorting the two `moveCard` calls by `cardId` so two trades
  over the same pair of cards take their locks in the same order and one simply waits. Today
  Postgres resolves it by aborting one, which is data-safe and surfaces as a 500.
- **Escrow.** The systematic fix for offering one copy to four people. It needs trade expiry
  to avoid locking cards forever, and expiry is out of scope.
- **Push notifications.** `POST /trades` is the hook point; the board's pending-incoming count
  is the in-app stand-in the brief allows.
- Bundles, points-in-trade, real-time, chat and admin trade management are excluded by
  `TAKE_HOME.md`.

---

## Hours

_[TODO: hours]_
