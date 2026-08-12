import { copy } from "./copy";
import type { Card, Trade, TradeStatus, UserSummary } from "./types";

/**
 * What every trading surface derives off a `Trade`, with no React in it.
 *
 * The board row, the approve/decline screen and the wizard's review step all
 * render the same trade from different angles, and each one needs the same
 * handful of answers: which card leaves, who the other person is, whether the
 * row can be pressed, what the status sentence says. Those were copy-pasted
 * between `components/TradeRow.tsx` and `app/trade/[id].tsx` — comments
 * included, which is how two surfaces come to disagree about a rule that only
 * one of them was updated to reflect.
 *
 * A plain module rather than anything in `components/`, because none of it
 * renders and `trade-review.ts` needs it: a `.ts` file reaching into a `.tsx`
 * for `giveAndGet` was the inversion this file removes.
 */

/**
 * Which side of a trade the viewer is on.
 *
 * The stored columns are sender-relative — `offeredCard` always belongs to
 * `fromUser` — so one row means opposite things to the two parties (DESIGN.md,
 * "Column names are sender-relative"). Everything below that reads a card, a
 * partner or a status sentence needs this to answer correctly for both.
 */
export type TradeDirection = "sent" | "received";

/**
 * Which card the viewer loses and which they gain.
 *
 * Exported because it is the one piece of trade logic that is easy to get
 * backwards and every trading surface needs it — a confirmation sentence naming
 * the two cards has to agree with the thumbnails above it, and re-deriving the
 * inversion at each call site is how the two drift apart.
 *
 * `sent`: the viewer offered `offeredCard` and asked for `requestedCard`.
 * `received`: the inverse — the sender's `offeredCard` is what the viewer
 * *gains*, and the `requestedCard` they named is the viewer's own, so it is
 * what the viewer *gives*.
 */
export function giveAndGet(
  direction: TradeDirection,
  offeredCard: Card,
  requestedCard: Card
): { give: Card; get: Card } {
  return direction === "sent"
    ? { give: offeredCard, get: requestedCard }
    : { give: requestedCard, get: offeredCard };
}

/** The other person, whichever side of the trade the viewer is on. */
export function partnerOf(trade: Trade): UserSummary {
  return trade.direction === "sent" ? trade.toUser : trade.fromUser;
}

/**
 * Whether this trade does anything when pressed.
 *
 * Exactly one of the eight direction/status/fulfillable combinations is
 * actionable: a PENDING trade sent *to* the viewer that can still complete.
 *
 * Two rules are load-bearing here.
 *
 * **A sent trade has no action, ever.** There is no cancel or withdraw
 * endpoint, and the sender cannot decline their own offer — `POST
 * /trades/:id/decline` 403s anyone but the recipient, deliberately, because
 * reporting a withdrawal as the other person's refusal would corrupt the one
 * column whose job is to record what a human did. So an outgoing row is inert
 * in every status.
 *
 * **`fulfillable === false` is not actionable**, and the test is against
 * `false` rather than falsiness — see `isUnfulfillable`. A `null` on a live
 * PENDING row is not something `GET /trades` produces, but if it ever appeared,
 * leaving the row actionable is the safe side: accept re-verifies ownership
 * atomically and refuses on its own terms.
 */
export function isActionable(trade: Trade): boolean {
  return (
    trade.direction === "received" && trade.status === "PENDING" && trade.fulfillable !== false
  );
}

/**
 * Whether to draw the can't-complete treatment: the dimmed cards and the note
 * on a row, the banner on the review screen.
 *
 * Strictly `false`, never falsiness. `fulfillable` is `boolean | null` and
 * `null` means "not applicable" — the serializer forces it for every answered
 * trade — so testing this loosely would paint every finished trade as a broken
 * one.
 */
export function isUnfulfillable(trade: Trade): boolean {
  return trade.fulfillable === false;
}

/**
 * `TradeStatus` is SCREAMING_CASE on the wire; `copy.board.status` is keyed
 * lowercase.
 *
 * `statusLine` is the only caller in the app. It stays exported because the
 * suites index `copy.board.status` through it rather than writing the lowercase
 * keys out a second time, and because one map is one place to fix the day a
 * fourth status appears.
 */
export const STATUS_KEY = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  DECLINED: "declined",
} as const satisfies Record<TradeStatus, string>;

/**
 * The sentence describing where this trade stands.
 *
 * Direction-keyed, because the same row means opposite things to the two
 * parties: one person's "you accepted" is the other's "they accepted". The
 * board row and the review screen render this from one set of strings so the
 * two surfaces cannot end up saying different things about one trade.
 */
export function statusLine(trade: Trade): string {
  return copy.board.status[trade.direction][STATUS_KEY[trade.status]];
}

/**
 * The date to show for a trade, formatted for the device.
 *
 * `createdAt`, not `respondedAt`. The board is ordered by creation, so a
 * month-old trade answered today sits a month down the list — showing the
 * creation date is what makes that ordering read as deliberate rather than
 * broken, and the review screen shows the same date for the same reason.
 *
 * An unparseable timestamp returns `""` rather than "Invalid Date". Both call
 * sites test for the empty string and draw nothing, so a date the client cannot
 * read costs a gap in a metadata row instead of a wrong word in it.
 */
export function tradeDateLabel(trade: Trade): string {
  const created = new Date(trade.createdAt);
  return Number.isNaN(created.getTime()) ? "" : created.toLocaleDateString();
}
