import { Prisma, type Trade as PrismaTrade } from "@prisma/client";
import type { CreateTradeRequest, Trade } from "@turnapp/shared";
import { asyncRouter } from "../async-router";
import { prisma } from "../prisma";
import { requireAuth } from "../auth";
import { toPublicTrade } from "../serialize";

/**
 * Trading: the board, and the three things a person can do to a trade.
 *
 * `GET /` reads every trade the caller is part of; `POST /` offers one;
 * `POST /:id/accept` and `POST /:id/decline` are the two ways it ends. Accept
 * and decline are named actions rather than a `PATCH { status }` because they
 * carry wildly different side effects behind the same narrow authorization —
 * naming them closes the state machine and makes the authz check impossible to
 * miss on one of them.
 *
 * Like `usersRouter`, this mounts ahead of `appRouter` in `app.ts`. That is a
 * preference, not a requirement: `appRouter` sits on "/" and runs `requireAuth`
 * for everything reaching it, but `requireAuth` calls `next()` and none of its
 * own routes match `/trades/...`, so the request falls through and Express
 * carries on to the next layer whichever order they mount in. Going first just
 * avoids running `requireAuth` twice and keeps an anonymous 401 coming from the
 * router that owns the path. Same auth posture either way: the whole router is
 * behind `requireAuth` and the sender is always `req.auth.userId`, never
 * anything the caller put in the body.
 *
 * Built with `asyncRouter()`, never `express.Router()` — AGENTS.md requires it
 * of every router here. Express 4 discards the promise an `async` handler
 * returns, so a rejection inside one is an unhandled rejection and Node 20
 * exits on it: a single malformed request would take the API down for
 * everybody. See `../async-router` for why the wrapping happens at
 * registration rather than a handler at a time.
 */
export const tradesRouter = asyncRouter();

tradesRouter.use(requireAuth);

/**
 * The one error string with two ways of being reached.
 *
 * The application check below and the database's partial unique index are the
 * same rule enforced at two moments, and a user who loses the race deserves the
 * same message as one who didn't race at all. Sharing the constant is what
 * stops those two answers from drifting apart.
 */
const DUPLICATE_OFFER = "You've already sent this offer. Check your sent requests.";

/**
 * Answering is a one-time event, and this is what losing that race sounds like.
 *
 * Reached four ways — the readable pre-check in each of accept and decline, and
 * the guarded claim in each, which is the one that actually decides. Same rule
 * at four moments, so the same sentence, for the same reason `DUPLICATE_OFFER`
 * is shared: a user who lost a race deserves the answer a user who didn't race
 * gets. It deliberately does not name accepted or declined — the claim can only
 * report that somebody got here first, and a message that varied by how the
 * caller found out would be describing our plumbing rather than their trade.
 */
const ALREADY_ANSWERED = "This trade has already been answered. Refresh to see how it ended.";

/**
 * One sentence for an id that names no trade, shared by accept and decline.
 *
 * Both routes look the trade up the same way and neither can say anything more
 * specific: a deleted trade and an id that never existed are indistinguishable
 * here, and telling the two apart would confirm to a stranger that some id they
 * guessed was once real.
 */
const TRADE_NOT_FOUND = "We couldn't find that trade.";

/**
 * Everything `toPublicTrade` needs, and nothing it doesn't.
 *
 * Top-level `include` for the trade's own columns, nested `select` for the two
 * users: the serializer wants id, username and userIdNumber, and `User` also
 * carries `email` and `passwordHash`. A bare `include: { fromUser: true }`
 * pulls both into API memory, where a log line or an error dump can reach them.
 */
const TRADE_WITH_PARTIES = {
  fromUser: { select: { id: true, username: true, userIdNumber: true } },
  toUser: { select: { id: true, username: true, userIdNumber: true } },
  offeredCard: true,
  requestedCard: true,
} as const;

/**
 * A refusal that already knows its status code and its user-facing sentence.
 *
 * Thrown from inside the accept transaction, which is the only place that can
 * discover these — so it has to unwind the transaction to report them, and the
 * unwinding is the point: rolling back is how "all of it or none of it" is
 * enforced. The message is copy, not a code, because by the time it reaches the
 * catch there is nothing left to map it against.
 */
class TradeError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "TradeError";
  }
}

/**
 * Read one id out of an untrusted body.
 *
 * Returns null for anything that isn't a non-empty string, so `null`, numbers
 * and objects are rejected by the same branch as a missing key rather than
 * being coerced into a lookup — `String(null)` is `"null"`, which is a
 * perfectly valid thing to go looking for and a terrible thing to go looking
 * for. Trimming matches how `POST /scan` reads its code.
 */
function readId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Does this user hold at least one copy of this card right now?
 *
 * `quantity >= 1` is how ownership is defined everywhere else in the app: the
 * swap deletes a `UserCard` row when its last copy leaves, so a row sitting at
 * zero is not expected — but if one ever exists it must not count as owning
 * something you can trade away.
 *
 * This is a precondition, not an invariant. It is true when the trade is
 * created and is specifically *supposed* to become false when the trade
 * executes, which is why it lives here and in the accept transaction rather
 * than in a foreign key. See DESIGN.md, Decision 1.
 */
async function ownsAtLeastOne(userId: string, cardId: string): Promise<boolean> {
  const row = await prisma.userCard.findUnique({
    where: { userId_cardId: { userId, cardId } },
    select: { quantity: true },
  });
  return (row?.quantity ?? 0) >= 1;
}

/**
 * One `(userId, cardId)` pair, flattened into something a Map can key on.
 *
 * The separator is a null byte because ids are cuids and a cuid cannot contain
 * one, so no two distinct pairs can collide on a key — a plain `:` would be
 * fine today and quietly wrong the day an id format changes. This value never
 * reaches Postgres, which refuses null bytes inside a `text`; it exists only
 * between a Map and a Set in this process.
 */
function holdingKey(userId: string, cardId: string): string {
  return `${userId}\u0000${cardId}`;
}

/** The trade columns fulfillability is computed from, and nothing else. */
type TradeOwnership = Pick<
  PrismaTrade,
  "id" | "status" | "fromUserId" | "toUserId" | "offeredCardId" | "requestedCardId"
>;

/**
 * Which of these pending trades could still go through, in one query.
 *
 * A trade is fulfillable when both sides still hold what they named: the sender
 * still owns the offered card, the recipient still owns the requested one. That
 * is derived here rather than stored, because several pending trades may name
 * the same copy and accepting one only invalidates the others when the quantity
 * actually reaches zero — two of three stay valid if the owner had two copies.
 * A stored flag would need a write-side cascade that cannot know that, and a
 * derived value cannot itself go stale. See DESIGN.md, "Concurrency: many
 * trades, one copy".
 *
 * **One `UserCard` query for the whole board, not two per trade.** Every
 * (user, card) pair the board asks about is collected first, deduplicated — the
 * same copy being contended by three offers is the normal case, not a corner
 * one — and resolved in a single `findMany`, then mapped back by key. The
 * alternative reads as harmless in a test with two trades and turns a board of
 * forty into eighty round trips.
 *
 * `quantity >= 1` is how ownership is defined everywhere else in the app: the
 * swap deletes a row when its last copy leaves, so a row at zero is not
 * expected — but if one exists it is not a card anybody can trade away, and
 * saying otherwise here would promise a trade that accept then refuses.
 *
 * Answered trades are skipped entirely. `fulfillable` is only meaningful while
 * a trade is pending, the serializer forces null for the rest regardless, and
 * their cards have already moved — including them would cost queries to compute
 * an answer that is thrown away.
 */
async function fulfillabilityOf(trades: TradeOwnership[]): Promise<Map<string, boolean>> {
  const answers = new Map<string, boolean>();

  const pending = trades.filter((t) => t.status === "PENDING");
  if (pending.length === 0) return answers;

  const wanted = new Map<string, { userId: string; cardId: string }>();
  for (const trade of pending) {
    wanted.set(holdingKey(trade.fromUserId, trade.offeredCardId), {
      userId: trade.fromUserId,
      cardId: trade.offeredCardId,
    });
    wanted.set(holdingKey(trade.toUserId, trade.requestedCardId), {
      userId: trade.toUserId,
      cardId: trade.requestedCardId,
    });
  }

  // An OR of exact pairs rather than `userId in (…) AND cardId in (…)`: the
  // cross-product form is one query too, but it reads rows for pairs nobody
  // asked about and grows as the product of the two lists. Each branch here is
  // a lookup on the (userId, cardId) unique index.
  const held = await prisma.userCard.findMany({
    where: {
      quantity: { gte: 1 },
      OR: [...wanted.values()],
    },
    select: { userId: true, cardId: true },
  });
  const owned = new Set(held.map((row) => holdingKey(row.userId, row.cardId)));

  for (const trade of pending) {
    answers.set(
      trade.id,
      owned.has(holdingKey(trade.fromUserId, trade.offeredCardId)) &&
        owned.has(holdingKey(trade.toUserId, trade.requestedCardId))
    );
  }
  return answers;
}

/**
 * The board: every trade I am part of, in both directions, newest first.
 *
 * One flat array rather than `{ sent: [], received: [] }` — one shape to
 * maintain, and the client renders all/incoming/outgoing by filtering on
 * `direction`, matching the pill pattern already on the collectibles screen.
 * `direction` is resolved per trade by the serializer against the caller's own
 * id, because the stored columns are sender-relative: `offeredCard` always
 * belongs to `fromUser`, so one row reads inverted for the two parties.
 *
 * The `where` is the access control, and it is the only one. There is no trade
 * id in this request to check an owner against — the caller's token *is* the
 * query — so a trade the caller is not part of is not filtered out afterwards,
 * it is never read. (`toPublicTrade` also throws for a non-participant viewer,
 * which is a backstop against a slip in this clause, not the control itself.)
 *
 * Every status is returned, not just the live ones. Acceptance criterion 7
 * wants a declined trade to still read as declined on both boards, and `Trade`
 * is a permanent log rather than a queue of open offers.
 *
 * `id` breaks ties on `createdAt` so the order is total. Two trades created in
 * the same millisecond are unlikely and not impossible, and without a
 * tiebreaker their relative order is whatever the plan happened to produce —
 * which is a list that reshuffles between two identical requests.
 */
tradesRouter.get("/", async (req, res) => {
  const viewerId = req.auth!.userId;

  const trades = await prisma.trade.findMany({
    where: { OR: [{ fromUserId: viewerId }, { toUserId: viewerId }] },
    include: TRADE_WITH_PARTIES,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  // Computed for the whole page at once, then read back per trade. Passing an
  // explicit value — including `null` for the answered ones, which the map has
  // no entry for — is what `toPublicTrade` requires rather than defaulting,
  // since a silent null on a live pending trade reads to a client as "already
  // answered".
  const fulfillable = await fulfillabilityOf(trades);

  const board: Trade[] = trades.map((trade) =>
    toPublicTrade(trade, viewerId, fulfillable.get(trade.id) ?? null)
  );
  res.json(board);
});

/**
 * Offer one of my cards for one of yours.
 *
 * Creates a PENDING row and nothing else. No card moves until the recipient
 * accepts, so this endpoint never touches `UserCard` except to read it.
 *
 * Three of the checks below are also enforced by the database — self-trade and
 * same-card as CHECK constraints, duplicate-pending as a partial unique index.
 * That is deliberate belt and braces: the constraints are the guarantee, and
 * these checks are what turns a violation into a sentence a person can read.
 * `apps/mobile/src/api.ts` throws `body.error` straight into the UI.
 *
 * The try/catch is what turns the duplicate race into a 409 rather than a 500;
 * `asyncRouter` is the backstop underneath it, carrying anything this handler
 * doesn't recognise to the error middleware instead of out of the process. The
 * unrecognised cases are real: `toPublicTrade` throws for a non-participant
 * viewer, which cannot happen on this path (the viewer is the sender by
 * construction), and Prisma can still raise on a connection fault. Answering
 * them here keeps the copy about sending an offer, which is what the caller was
 * trying to do.
 */
tradesRouter.post("/", async (req, res) => {
  // Every value stays `unknown` until `readId` has vouched for it. The shape is
  // `CreateTradeRequest`, but only once it has been checked — typing the body
  // as that interface would assert the very thing this block is here to verify.
  const body = (req.body ?? {}) as Partial<Record<keyof CreateTradeRequest, unknown>>;

  const toUserId = readId(body.toUserId);
  if (!toUserId) return res.status(400).json({ error: "Choose someone to trade with." });

  const offeredCardId = readId(body.offeredCardId);
  if (!offeredCardId) {
    return res.status(400).json({ error: "Choose one of your cards to offer." });
  }

  const requestedCardId = readId(body.requestedCardId);
  if (!requestedCardId) {
    return res.status(400).json({ error: "Choose a card to ask for." });
  }

  // The sender is the token holder. A `fromUserId` in the body is ignored, not
  // rejected: there is no request this endpoint could receive where the body
  // gets a say in who is trading.
  const fromUserId = req.auth!.userId;

  if (toUserId === fromUserId) {
    return res.status(400).json({ error: "You can't trade with yourself." });
  }

  if (offeredCardId === requestedCardId) {
    return res
      .status(400)
      .json({ error: "That's the same card on both sides. Pick a different one to ask for." });
  }

  try {
    // `select`, not `include`. Only the id is in question, and `User` carries
    // `email` and `passwordHash` — a bare `findUnique` pulls both into API
    // memory where a log line or an error dump can reach them.
    const recipient = await prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true },
    });
    if (!recipient) {
      return res.status(404).json({ error: "We couldn't find that person." });
    }

    // One round trip for both cards; the messages still name which one is
    // missing, because "card not found" is useless in a two-card form.
    const cards = await prisma.card.findMany({
      where: { id: { in: [offeredCardId, requestedCardId] } },
      select: { id: true },
    });
    const foundCardIds = new Set(cards.map((c) => c.id));
    if (!foundCardIds.has(offeredCardId)) {
      return res.status(404).json({ error: "We couldn't find the card you're offering." });
    }
    if (!foundCardIds.has(requestedCardId)) {
      return res.status(404).json({ error: "We couldn't find the card you asked for." });
    }

    if (!(await ownsAtLeastOne(fromUserId, offeredCardId))) {
      return res.status(400).json({ error: "You don't have that card to offer." });
    }

    if (!(await ownsAtLeastOne(toUserId, requestedCardId))) {
      return res.status(400).json({ error: "They don't have the card you asked for." });
    }

    // Checked after ownership on purpose: if you sent this offer and have since
    // traded the card away, "you don't have that card" is the more useful of
    // the two true answers.
    const openOffer = await prisma.trade.findFirst({
      where: { fromUserId, toUserId, offeredCardId, requestedCardId, status: "PENDING" },
      select: { id: true },
    });
    if (openOffer) {
      return res.status(409).json({ error: DUPLICATE_OFFER });
    }

    const created = await prisma.trade.create({
      data: { fromUserId, toUserId, offeredCardId, requestedCardId },
      include: TRADE_WITH_PARTIES,
    });

    // `true`, not `null`. Both ownership checks just passed, so this trade is
    // fulfillable as of right now — and `null` means "not applicable", which
    // clients read as an already-answered trade.
    const dto: Trade = toPublicTrade(created, fromUserId, true);
    return res.status(201).json(dto);
  } catch (e) {
    // The race the application check above cannot win: two identical requests
    // both read no open offer, both insert, and the partial unique index
    // rejects the second. Same rule, same answer — a 500 here would be the
    // database doing its job and the API calling it a bug.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: DUPLICATE_OFFER });
    }

    console.error(e);
    // Nothing above sends a response before throwing, but a 500 written over an
    // already-sent 201 would throw again from inside the catch.
    if (res.headersSent) return;
    return res.status(500).json({ error: "Something went wrong sending that offer." });
  }
});

/**
 * Hand one copy of a card from one collection to another, inside a transaction.
 *
 * `UserCard` is `(userId, cardId, quantity)` — a count, not a row per copy — so
 * moving a card is a guarded decrement on one side and an upsert on the other,
 * and the guard is the whole point. The precondition "the giver still owns
 * this" lives in the `where` of an `updateMany` and is checked by `count`,
 * which is the idiom `POST /scan` uses to claim a code. Under READ COMMITTED a
 * concurrent writer blocks on the row lock and then *re-evaluates* the
 * predicate, so `quantity: { gte: 1 }` cannot be beaten by a racing trade the
 * way a read-then-write could.
 *
 * `whenGiverHasNone` is the sentence for the caller if that guard fires. It is
 * a parameter rather than a shared constant because the two calls fail for
 * opposite reasons — one side is "they don't have it any more", the other is
 * "you don't" — and a recipient can act on the difference.
 *
 * Throwing aborts the surrounding transaction, which is the intended outcome:
 * a half-completed swap is worse than a refused one.
 */
async function moveCard(
  tx: Prisma.TransactionClient,
  fromUserId: string,
  toUserId: string,
  cardId: string,
  whenGiverHasNone: string
) {
  const taken = await tx.userCard.updateMany({
    where: { userId: fromUserId, cardId, quantity: { gte: 1 } },
    data: { quantity: { decrement: 1 } },
  });
  if (taken.count === 0) throw new TradeError(409, whenGiverHasNone);

  // Delete the row once its last copy leaves. `GET /cards` reports ownership as
  // `owned: !!uc`, so a leftover row at zero would keep telling the giver they
  // still have a card they just traded away. `lte: 0` rather than `equals: 0`
  // so a row that somehow went negative is cleared out too, instead of being
  // left behind as a permanent phantom.
  await tx.userCard.deleteMany({ where: { userId: fromUserId, cardId, quantity: { lte: 0 } } });

  // Increment, or create at 1. `upsert`, not `create`: the receiver may well
  // already own a copy, and `create` would hit the (userId, cardId) unique
  // constraint and fail an otherwise perfectly good trade.
  await tx.userCard.upsert({
    where: { userId_cardId: { userId: toUserId, cardId } },
    create: { userId: toUserId, cardId, quantity: 1 },
    update: { quantity: { increment: 1 } },
  });
}

/**
 * Accept a trade: both cards change hands, or nothing does.
 *
 * Only the recipient may accept, and only while the trade is still pending.
 * Ownership is re-verified here rather than trusted from creation time —
 * between the offer and this request either party may have traded the card
 * away, and "the sender no longer has what they offered" is the case that
 * separates a swap that works from one that quietly creates or destroys a card.
 *
 * Claiming the trade first, before either `moveCard`, is deliberate — but not
 * because moving first would let the swap happen twice. It wouldn't: the claim
 * is in the same transaction, so a loser that has already moved both cards
 * still fails the claim and unwinds the moves with it. Either order swaps
 * exactly once.
 *
 * What the order buys is the right answer and a smaller lock footprint. A loser
 * that moved first reports "they no longer have the card they offered" —
 * describing a copy this very request just took — when the truth is that
 * somebody already answered. And it would take `UserCard` locks it is only
 * going to throw away, holding them against every other trade touching those
 * rows for as long as it takes to discover it had already lost.
 *
 * The checks above the transaction are for a readable answer, not for
 * correctness — by the time they return, all three could be stale. The claim
 * inside is the one that decides, and it carries both of the preconditions it
 * can carry: the trade is still pending, and it is still addressed to the
 * person answering it.
 */
tradesRouter.post("/:id/accept", async (req, res) => {
  const viewerId = req.auth!.userId;

  // Only the columns the decision needs. `include`-ing the parties here would
  // pull two `User` rows — emails and hashes included — for a request that may
  // well end in a 403.
  const trade = await prisma.trade.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      fromUserId: true,
      toUserId: true,
      offeredCardId: true,
      requestedCardId: true,
      status: true,
    },
  });
  if (!trade) return res.status(404).json({ error: TRADE_NOT_FOUND });

  // The recipient answers, and nobody else — not the sender, who would
  // otherwise be able to take a card by offering for it, and not a bystander
  // who guessed an id.
  if (trade.toUserId !== viewerId) {
    return res.status(403).json({ error: "Only the person this trade was sent to can accept it." });
  }

  if (trade.status !== "PENDING") {
    return res.status(409).json({ error: ALREADY_ANSWERED });
  }

  try {
    const accepted = await prisma.$transaction(async (tx) => {
      // Claim first. Whoever flips PENDING wins; a second accept sees count 0
      // and unwinds before it can move anything.
      //
      // `toUserId` is in the filter as well as `status`. The 403 above reads
      // the trade in a query of its own, so this statement is the only point
      // where "the person accepting is the recipient" can be true of the row
      // actually being written. Filtering on `status` alone is safe only while
      // `toUserId` never changes — a property of today's codebase, not of this
      // code, and not one the statement that authorises a swap should lean on.
      const claim = await tx.trade.updateMany({
        where: { id: trade.id, status: "PENDING", toUserId: viewerId },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      if (claim.count === 0) throw new TradeError(409, ALREADY_ANSWERED);

      await moveCard(
        tx,
        trade.fromUserId,
        trade.toUserId,
        trade.offeredCardId,
        "They no longer have the card they offered, so this trade can't go through."
      );
      await moveCard(
        tx,
        trade.toUserId,
        trade.fromUserId,
        trade.requestedCardId,
        "You no longer have the card they asked for, so this trade can't go through."
      );

      // Read the row back inside the transaction rather than assuming what the
      // claim wrote: `updateMany` returns a count, and `respondedAt` is a
      // stored value the client will render.
      return tx.trade.findUniqueOrThrow({ where: { id: trade.id }, include: TRADE_WITH_PARTIES });
    });

    // `null`, not `false`. Fulfillability only describes a pending trade, and
    // the serializer forces null for an answered one regardless — passing a
    // computed value here would be a claim this endpoint never checked.
    const dto: Trade = toPublicTrade(accepted, viewerId, null);
    return res.json(dto);
  } catch (e) {
    // The refusals the transaction had to unwind to discover. Everything else —
    // a Prisma fault, a serialization failure, a deadlock aborted by Postgres —
    // is not something this route can describe, so it goes to the error
    // middleware, which logs it and answers a fixed sentence. That path exists
    // because this router is an `asyncRouter`.
    if (e instanceof TradeError) {
      return res.status(e.status).json({ error: e.message });
    }
    throw e;
  }
});

/**
 * Decline a trade: the offer is refused and nothing moves.
 *
 * Same authorization as accept — only the recipient answers, and only while the
 * trade is still pending — and the same guarded claim, for the same reason. Two
 * simultaneous responses must not both succeed, and the `where` on this
 * `updateMany` is what decides that: the loser matches nothing and hears
 * `ALREADY_ANSWERED`, whether the winner accepted or declined.
 *
 * **This endpoint never touches `UserCard`.** That is the whole behaviour, not
 * an incidental property of it — declining is the one response that leaves both
 * collections exactly as it found them. Note there is no `$transaction` here
 * and there should not be: accept needs one because it writes three tables and
 * a half-done swap is worse than a refused one, whereas decline writes a single
 * row with a single statement, which Postgres already applies all-or-nothing.
 * Wrapping one statement would only suggest there is a second one to protect.
 *
 * Ownership is deliberately *not* re-checked. A sender who has since traded the
 * offered card away should still be able to have their dead offer refused —
 * blocking that would leave it pending forever, and it is exactly the offer a
 * recipient most wants off their board.
 *
 * The row is read back after the claim rather than assumed from it: `updateMany`
 * returns a count, and `respondedAt` is a stored value the client renders. No
 * transaction is needed to make that read safe — every transition starts from
 * PENDING, so once this request has won the claim the row cannot change again.
 */
tradesRouter.post("/:id/decline", async (req, res) => {
  const viewerId = req.auth!.userId;

  // Only the columns the decision needs. `include`-ing the parties here would
  // pull two `User` rows — emails and hashes included — for a request that may
  // well end in a 403.
  const trade = await prisma.trade.findUnique({
    where: { id: req.params.id },
    select: { id: true, toUserId: true, status: true },
  });
  if (!trade) return res.status(404).json({ error: TRADE_NOT_FOUND });

  // The recipient answers, and nobody else. A sender who has changed their mind
  // has no business declining their own offer: it would report their withdrawal
  // as the other person's refusal, in a status column whose only job is to say
  // what a human did. Cancelling a sent offer is a different verb, and one this
  // API does not have yet.
  if (trade.toUserId !== viewerId) {
    return res
      .status(403)
      .json({ error: "Only the person this trade was sent to can decline it." });
  }

  // A readable answer, not the decision. By the time this returns it may
  // already be stale; the claim below is the one that decides.
  if (trade.status !== "PENDING") {
    return res.status(409).json({ error: ALREADY_ANSWERED });
  }

  // `toUserId` is in the claim as well as in the 403 above, and the two are not
  // redundant. The check above is a read, so what it authorized is a fact about
  // a row as it looked a moment ago; this `where` is evaluated by Postgres
  // against the row it is about to write, under the lock it takes to write it.
  // That is the only place an authorization decision and the write it permits
  // are atomic with each other. It costs nothing — the row is being located by
  // primary key regardless — and it stops this route's correctness from resting
  // on `Trade.toUserId` never being updatable, which is true of the schema
  // today and is not a thing this handler knows.
  //
  // `status` is the half that arbitrates the race: whoever flips PENDING wins,
  // and the loser matches nothing.
  const claim = await prisma.trade.updateMany({
    where: { id: trade.id, status: "PENDING", toUserId: viewerId },
    data: { status: "DECLINED", respondedAt: new Date() },
  });
  if (claim.count === 0) return res.status(409).json({ error: ALREADY_ANSWERED });

  const declined = await prisma.trade.findUniqueOrThrow({
    where: { id: trade.id },
    include: TRADE_WITH_PARTIES,
  });

  // `null`, not `false`. Fulfillability only describes a pending trade, and the
  // serializer forces null for an answered one regardless — passing a computed
  // value here would be a claim this endpoint never checked. `false` would also
  // read to a client as "this one failed", which is not what declining is.
  const dto: Trade = toPublicTrade(declined, viewerId, null);
  return res.json(dto);
});
