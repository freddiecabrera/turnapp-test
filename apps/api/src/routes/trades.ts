import { Prisma } from "@prisma/client";
import { Router } from "express";
import type { CreateTradeRequest, Trade } from "@turnapp/shared";
import { prisma } from "../prisma";
import { requireAuth } from "../auth";
import { toPublicTrade } from "../serialize";

/**
 * Trading. This file is the create half; accept and decline land beside it.
 *
 * Like `usersRouter`, this mounts ahead of `appRouter` in `app.ts` — that one
 * sits on "/" and runs `requireAuth` for everything reaching it, so a router
 * mounted after it never sees its own requests. Same auth posture though: the
 * whole router is behind `requireAuth` and the sender is always
 * `req.auth.userId`, never anything the caller put in the body.
 */
export const tradesRouter = Router();

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
 * The whole handler sits in a try/catch because Express 4 does not route async
 * rejections to the error middleware — an uncaught rejection here takes the
 * process down rather than returning a 500. `toPublicTrade` throws for a
 * non-participant viewer, which cannot happen on this path (the viewer is the
 * sender by construction), and Prisma can still raise on a connection fault.
 * Neither is allowed to escape.
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
      // Top-level `include` for the trade's own columns, nested `select` for
      // the two users: `toPublicTrade` needs id, username and userIdNumber and
      // must never be handed a row carrying an email address or a hash.
      include: {
        fromUser: { select: { id: true, username: true, userIdNumber: true } },
        toUser: { select: { id: true, username: true, userIdNumber: true } },
        offeredCard: true,
        requestedCard: true,
      },
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
