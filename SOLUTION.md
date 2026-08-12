# Card trading — write-up

The design reasoning lives in [`DESIGN.md`](DESIGN.md), and the setup quirks in
[`AGENTS.md`](AGENTS.md). This is the front door: what exists, how to run it, and what I
decided along the way.

---

## What was built

Card trading down to the database: a `Trade` model with its migration, six endpoints behind
`requireAuth`, the shared DTOs, and 165 API tests.

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

**The mobile screens sit on top of it**: the trading board behind the existing `trading board`
pill, a four-step create-trade wizard, and the approve/decline screen — with 158 mobile tests
beside them. Every user-facing string lives in one file, `apps/mobile/src/copy.ts`, so the
wording is editable without touching a component.

### A design pass over the board

The first version of the board worked and read badly, and two later PRs fixed that rather than
leaving it as shipped-and-defended.

It had stacked **four rows of controls above the first trade**: the collectibles pill row it
lives under, an `all / incoming / outgoing` filter, a black pending-count badge, and an
outlined `+ Start a trade` pill. Three wore the same shape — pill radius, 1.5px black border —
so navigation, filtering and the one control that *creates* something all read as the same
kind of object, and two were filled solid black at once.

- **The filter became section headers.** A trade sits under `needs you`, `waiting` or
  `history`, each carrying its own count. This answers the question people open the board with
  — what needs me? — which a direction filter cannot ask, because `incoming` mixes the one
  unanswered offer in with every incoming trade already settled. `needsYou` is exactly
  `isActionable`, so the section a row sits under and whether it can be pressed cannot
  disagree. The pending-count badge folded into the header that was going to be drawn anyway.
- **Status moved into a chip in the row header** — the most scannable fact about a trade was
  the last thing on the card, under two pieces of art. Only an actionable row gets the filled
  chip, so the screen has one strongest emphasis rather than three.
- **`Start a trade` became a floating button** with one permanent home, instead of being a
  full-width button on an empty board and a small outlined pill on a populated one.
- **Dates read relatively** for the first week, counted in local calendar days — a trade sent
  at 11pm is `yesterday` from midnight, not for another twenty-two hours.

**And every card is drawn whole.** Each card box was `aspectRatio: 0.7` — the proportions of a
physical trading card. A turn card is 575 × 1198, a ratio of 0.48, and `cover` in a box of the
wrong shape had been cropping the bottom third off every card in the feature: the story, cut
mid-sentence, including on the screen where somebody decides whether to accept. `CARD_ASPECT`
now lives in `theme.ts` because four surfaces draw a card and they have to agree on its shape.

The wizard's grids had a second bug behind the same symptom: `SelectableCell` was `flex: 1`,
and a `FlatList` with `numColumns={3}` lays a short final row out as a row of *that many*
flexible children — so a collection of seven drew six normal cards and then one card three
times the size of its neighbours, and a collection of four drew a full-width one. Cells are
measured now, and a test pins the property that makes that correct: a full row of cells plus
its gutters comes to exactly the window width, at every phone size from 320 to 1024pt.

---

## How to run and test it

From the repo root, on a fresh clone:

```bash
cp .env.example .env                # required first — the Prisma scripts read it
npm install                         # workspaces: packages/*, apps/api, apps/admin
npm --prefix apps/mobile install --legacy-peer-deps   # mobile is NOT a workspace
npm run api:setup                   # docker postgres + prisma generate + migrate + seed
```

One command is the whole gate:

```bash
npm run verify   # api typecheck + mobile typecheck + admin build + 323 tests
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

Three things, all pre-existing, all fixed on this branch.

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

### And one I introduced myself

**The user search I added was enumerable.** `GET /users/search` is new in this branch, so this
one is mine rather than a find: Prisma's `contains` compiles to `ILIKE '%' || $1 || '%'` and
escapes nothing, so `?q=%` returned every non-admin user. Caught and fixed before merge — `\`,
`%` and `_` are now escaped, which also makes a username containing an underscore searchable.
Worth listing next to the three above because it is the same class of defect, and because
writing the search is what taught me to look at `contains` in the first place.

---

## Connection to my evaluation of the live app

Before this exercise I evaluated the live turn app and filed 28 findings, seven of them in
Trading. Three describe the same failures this feature's acceptance criteria test for, which
made them the sharpest spec available.

**Cards listed in active trades remain selectable and redeemable** — filed High, and as an
open question, because trading and redeeming the same asset is either intended or an exploit
path. My suggested fix was server-side state on card availability enforced at redemption time
rather than client-side filtering. This build's answer is narrower and I'd rather name that
than overclaim: ownership is re-verified *inside* the accept transaction with a guarded
decrement, so a second claim on the same copy fails cleanly instead of minting one. That
closes the double-spend at the moment of the swap. It does not stop one copy being promised to
four people — escrow is the complete fix, and it needs offer expiry, which the brief puts out
of scope.

**Counter-offer flow: same-card counters allowed, cards shown without names, unlimited
duplicate submissions.** All three are closed. Offering and requesting the same card is
rejected at creation. Every card renders with its name beside its art — the finding's real
point was that similar-looking cards can't be verified from artwork alone before an
irreversible decision. And duplicate submissions are prevented by a partial unique index on
`(fromUserId, toUserId, offeredCardId, requestedCardId) WHERE status = 'PENDING'`. I asked for
an idempotency key on that mutation; the constraint is the stronger version, because it holds
no matter what the client does — the race that beats the route's own check still lands on the
index and gets the same 409.

**Trade vault shows every card in existence instead of my matching cards.** Both pickers are
fed by real collections — yours filtered to what you own, theirs from `GET /users/:id/cards`,
which returns only rows with `quantity >= 1`. You cannot request a card they don't have or
offer one you don't. The no-match empty state I asked for exists, including a case I hadn't
anticipated: the partner's only card being the one you're already offering.

And one I didn't expect to write. I filed **the trading hub losing scroll position** against
the live app, with the hypothesis that a remount was resetting the list — then reproduced it
in my own board, where switching tabs unmounted it and took its scroll offset — and, at the
time, its filter — with it. Fixed here. Writing the finding is not the same as being immune
to it.

---

## What I'd do with more time

- **Per-copy `UserCard` rows.** The model this schema wants: a swap becomes
  `UPDATE UserCard SET userId = ?`, with no decrement arithmetic and no delete-at-zero. It's
  11 files across four surfaces plus a data migration, which is why it isn't here.
- **Deterministic lock order** — sorting the two `moveCard` calls by `cardId` so two trades
  over the same pair of cards take their locks in the same order and one simply waits. Today
  Postgres resolves it by aborting one, which is data-safe and surfaces as a 500.
- **Escrow.** The systematic fix for offering one copy to four people. It needs trade expiry
  to avoid locking cards forever, and expiry is out of scope.
- **Push notifications.** `POST /trades` is the hook point; the board's `needs you` count is
  the in-app stand-in the brief allows.
- Bundles, points-in-trade, real-time, chat and admin trade management are excluded by
  `TAKE_HOME.md`.

---

## Hours

About 12 hours.
