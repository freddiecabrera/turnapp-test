import { ApiError } from "./api";
import { giveAndGet } from "./components/TradeCards";
import type { CardWithOwnership, Trade } from "./types";

/**
 * TH-12 — the decisions the approve/decline screen has to make, with no React
 * in them.
 *
 * Two of them are the reason this file exists rather than living inline. Which
 * side of an unfulfillable trade is broken is an *inference*, not something the
 * API told us, and what a failed answer can recover to is derived from a status
 * code plus a fresh read of the board. Both are worth stating once, in one
 * place, where the reasoning fits next to the rule.
 */

/** The two things the recipient can do. Nobody else can do either. */
export type Answer = "accept" | "decline";

/**
 * What the viewer's own collection says about the two cards on this trade.
 *
 * `Trade` carries plain `Card`s — no `quantity`, no `owned` — which is exactly
 * the information the decision turns on: whether the card you are handing over
 * is your only copy, and whether the one coming back is a duplicate. So the
 * screen joins `GET /cards` (the same call the collection grid and the wizard
 * already make) against the trade's two card ids.
 */
export interface Ownership {
  /** Copies of the card the viewer would give away. */
  giveQuantity: number;
  /** Copies of the card the viewer would receive. */
  getQuantity: number;
}

/**
 * Join the trade's two cards against the viewer's collection.
 *
 * `null` means "no answer", and it has two causes that must not be flattened
 * into a number: the collection has not loaded yet, or it loaded without one of
 * these cards on it. `GET /cards` is unfiltered and returns every card in every
 * season with `quantity: 0` for the ones the viewer does not own, so a missing
 * card is a genuine anomaly rather than a zero — and answering "you own none"
 * on a lookup that never happened is how a wrong sentence gets onto the screen.
 *
 * The give/get inversion goes through `giveAndGet` rather than being re-derived
 * here. `offeredCard` always belongs to `fromUser`, so on a received trade the
 * card the viewer gives is the `requestedCard` — the single most invertible
 * fact in this feature, and one place is where it stays right.
 */
export function ownershipOf(trade: Trade, cards: CardWithOwnership[] | null): Ownership | null {
  if (!cards) return null;

  const { give, get } = giveAndGet(trade.direction, trade.offeredCard, trade.requestedCard);
  const giving = cards.find((c) => c.id === give.id);
  const getting = cards.find((c) => c.id === get.id);
  if (!giving || !getting) return null;

  return { giveQuantity: giving.quantity, getQuantity: getting.quantity };
}

/** Whose half of an unfulfillable trade is broken, as far as this screen can tell. */
export type BrokenSide = "you" | "them" | "unknown";

/**
 * Infer which side of an unfulfillable trade lost their card.
 *
 * **This is inference. The API did not say.** `fulfillable` is a single boolean
 * computed from both ownership checks at once (`fulfillabilityOf` in
 * `routes/trades.ts`), so a `false` on the wire means "at least one of the two
 * no longer holds their card" and nothing finer. Accept can name the side —
 * `moveCard` carries a different sentence for each — but only by being called,
 * which is the one thing this state must not do.
 *
 * So the screen answers the half it can check itself: does the viewer still
 * hold the card they would be giving away? If not, that side is broken and the
 * screen can say so precisely. If they do hold it, then the failing check must
 * be the other one, and the sender is the side that no longer has their card.
 * With no collection loaded there is nothing to reason from, and the wording
 * stays side-neutral.
 *
 * Both reads are snapshots taken at different moments, so the inference can be
 * wrong in the window between them — the sender reacquiring their card, or the
 * viewer trading theirs away just after `GET /cards` answered. That is worth
 * one wrong sentence rather than none at all: nothing acts on this, `accept`
 * re-verifies ownership atomically and refuses on its own terms regardless, and
 * decline works either way.
 *
 * Only ever called with `trade.fulfillable === false`. Calling it otherwise
 * would ask which side is broken about a trade nothing said was broken.
 */
export function brokenSide(ownership: Ownership | null): BrokenSide {
  if (!ownership) return "unknown";
  return ownership.giveQuantity < 1 ? "you" : "them";
}

/**
 * The state of this trade as of a re-read taken *after* an answer was refused.
 *
 * `ok: false` is the re-read itself failing, which is a different thing from
 * `trade: null` (the board answered and this trade was not on it).
 */
export type Recheck = { ok: true; trade: Trade | null } | { ok: false };

/**
 * What a refused answer can offer next.
 *
 * - `decline` — the trade is still pending and declining it is guaranteed to
 *   work. The single most valuable affordance on the screen.
 * - `board` — nothing on this screen can move this trade any further.
 * - `retry` — the same request could succeed on a second attempt.
 */
export type Recovery = "decline" | "board" | "retry";

/**
 * Choose the recovery for a refused answer, from the status code and a fresh
 * read of the board.
 *
 * **Why a re-read instead of reading the message.** `POST /:id/accept` answers
 * 409 for two unrelated situations, and the only thing separating them on the
 * wire is the sentence: "already answered" is terminal, while "they/you no
 * longer have the card" leaves the trade PENDING and fully declinable. Matching
 * on those sentences would tie this screen's recovery path to server copy that
 * AGENTS.md explicitly treats as rewritable prose, and it would break silently
 * — the wrong recovery, no error anywhere. DESIGN.md refuses the same trick for
 * the same reason where it declines to match `40P01` inside a Prisma message.
 *
 * The trade's own status answers it without ambiguity: still PENDING after a
 * refused accept means the transaction rolled back and the offer survived;
 * anything else means somebody's answer already landed. That is a fact the
 * server publishes as data, on the endpoint this screen already uses.
 *
 * Costs one extra `GET /trades` on a failure path only, and the failure path is
 * where an extra round trip is worth the most.
 *
 * A re-read that fails cannot tell the two 409s apart, so an unclassified one
 * points at the board: it is the only recovery that is safe for both, since a
 * decline offered on an already-answered trade is a second guaranteed refusal
 * and a retry is the same. Everything that is not a 409 — 400, 403, 404, 500,
 * and a fetch that never arrived — gets `retry`, which is the honest offer for
 * a request that either could not be understood or never got an answer. 403 and
 * 404 are unreachable from a board that only pushes trades the viewer received,
 * so they share it rather than earning wording of their own.
 */
export function recoveryFor(error: unknown, answer: Answer, recheck: Recheck): Recovery {
  const status = error instanceof ApiError ? error.status : null;
  if (status !== 409) return "retry";

  if (!recheck.ok) return "board";

  // Decline is only a recovery for a refused *accept*. A refused decline that
  // somehow left the trade pending is a retry, not an invitation to press the
  // same button under a different name.
  if (answer === "accept" && recheck.trade?.status === "PENDING") return "decline";

  return "board";
}

/**
 * Whether a re-read caught the trade already finished.
 *
 * Two very different failures land here and both are better rendered as the
 * outcome than as an error. A 409 saying "this trade has already been answered.
 * Refresh to see how it ended" is a server sentence that names its own remedy,
 * and the re-read *is* that refresh. And a request whose response was lost in
 * transit fails on the client while having fully succeeded on the server — the
 * cards moved, and "that didn't go through" would be false.
 *
 * The outcome is rendered from the trade's real status, never from the answer
 * that was attempted, so a trade answered elsewhere reads as what actually
 * happened to it.
 */
export function finishedTrade(recheck: Recheck): Trade | null {
  if (!recheck.ok || !recheck.trade) return null;
  return recheck.trade.status === "PENDING" ? null : recheck.trade;
}
