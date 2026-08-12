import { useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { CardWithOwnership, OwnedCard, UserSummary } from "./types";

/**
 * TH-11 — the create-trade wizard's draft, and the two rules that keep it valid.
 *
 * **Why a module store rather than a context.** The wizard is three pushed
 * screens plus a review, and they are pushed onto the *root* stack: there is no
 * `_layout.tsx` under `app/trade/new/`, deliberately, because a nested
 * navigator would put the wizard's screens in a stack of their own and every
 * way out of it — back to the board on success, back to step 1 from a dead end
 * — would then have to cross a navigator boundary. Flat routes make `back`,
 * `dismissTo` and `dismissAll` all mean the obvious thing. The cost is that
 * there is no component above the four screens to hang a provider on, so the
 * draft lives here instead, read through `useSyncExternalStore`.
 *
 * **Why the draft survives going back.** The ticket requires that returning to
 * an earlier step keeps what was already chosen. Pushed screens stay mounted,
 * so their own local state (a search query, a scroll position) survives on its
 * own; this store is what makes the *selections* survive as well, including
 * across the two dead-end recoveries that jump backwards more than one screen.
 *
 * Reset happens when step 1 mounts, which is once per run of the wizard —
 * pushing forward and popping back do not remount it, and the only way to reach
 * step 1 again is to open the wizard afresh.
 */
export interface TradeDraft {
  /** Step 1. Never the caller and never staff: `GET /users/search` excludes both. */
  partner: UserSummary | null;
  /** Step 2. From `api.cards()`, filtered to `owned` — so `owned` is true, not assumed. */
  offered: CardWithOwnership | null;
  /** Step 3. From `api.userCards(partner.id)`, so the partner held it when the list loaded. */
  requested: OwnedCard | null;
}

const EMPTY: TradeDraft = { partner: null, offered: null, requested: null };

let draft: TradeDraft = EMPTY;
const listeners = new Set<() => void>();

function commit(next: TradeDraft) {
  draft = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The current draft. The snapshot is the object itself, and `commit` always
 * replaces it, so the identity check `useSyncExternalStore` performs is the
 * same check React would do on state.
 */
export function useTradeDraft(): TradeDraft {
  return useSyncExternalStore(subscribe, () => draft);
}

/** Called once, when step 1 mounts. See the note above on why that is enough. */
export function resetDraft(): void {
  commit(EMPTY);
}

/**
 * Choose who to trade with.
 *
 * Changing the partner clears the requested card, because that card was picked
 * out of a *particular person's* collection — keeping it would carry an
 * assertion about someone who is no longer in the trade, and `POST /trades`
 * would refuse it with "They don't have the card you asked for." after three
 * more steps of work. The offered card is deliberately kept: it is yours, it is
 * still yours, and re-picking it would be busywork.
 */
export function choosePartner(partner: UserSummary): void {
  if (draft.partner?.id === partner.id) {
    commit({ ...draft, partner });
    return;
  }
  commit({ ...draft, partner, requested: null });
}

/**
 * Choose the card you are giving.
 *
 * Clearing a requested card that matches is the same suppression step 3 does by
 * filtering, arriving from the other direction: step 3 cannot offer a card that
 * is already on the other side, but going *back* to step 2 afterwards and
 * picking that very card would put it on both sides anyway. Both halves are
 * needed, and together they make `POST /trades`'s "That's the same card on both
 * sides" unreachable from this UI rather than merely unlikely.
 */
export function chooseOffered(offered: CardWithOwnership): void {
  const requested = draft.requested?.id === offered.id ? null : draft.requested;
  commit({ ...draft, offered, requested });
}

/** Choose the card you are asking for. */
export function chooseRequested(requested: OwnedCard): void {
  commit({ ...draft, requested });
}

/**
 * Drop the offered card if the viewer no longer owns it.
 *
 * Steps 2 and 3 reload their collections whenever they regain focus, which is
 * the moment a selection can be discovered to have gone stale: accepting a
 * trade in another session, or on another device, moves a card out from under a
 * wizard that is still holding it. `POST /trades` would refuse it — "You don't
 * have that card to offer." — after four steps, and a selection the server will
 * reject is not a selection.
 *
 * Called with the ids of a *successful* load only. A failed refresh proves
 * nothing about what anybody owns, and clearing on one would treat a dropped
 * connection as a traded card.
 */
export function reconcileOffered(ownedIds: ReadonlySet<string>): void {
  if (draft.offered === null || ownedIds.has(draft.offered.id)) return;
  commit({ ...draft, offered: null });
}

/** The same, for a requested card the partner no longer holds. */
export function reconcileRequested(partnerIds: ReadonlySet<string>): void {
  if (draft.requested === null || partnerIds.has(draft.requested.id)) return;
  commit({ ...draft, requested: null });
}

/**
 * Re-exported so each wizard step keeps one import for the draft and the
 * failure string it renders beside it. The rule itself lives next to
 * `ApiError`, which is the class it tests.
 */
export { messageFor } from "./api";

/**
 * Which way out to offer for a failed send.
 *
 * `POST /trades` documents thirteen refusals. They collapse into three
 * recoveries, because a person does not need thirteen answers — they need to
 * know whether to change something, go look at something, or stop:
 *
 * - **`board`** — 409, the only one. This exact offer already exists and is
 *   pending, so the thing to do is go and look at it.
 * - **`repick`** — every 400 and 404 that survives to here. Something chosen
 *   earlier stopped being true: a card one side no longer owns, a person who no
 *   longer exists. All three "change what you picked" buttons are offered, and
 *   the server's own sentence above them says which one to press.
 * - **`retry`** — a 500, or a rejected fetch that never reached the server.
 *   Nothing to change; the same request may simply work.
 *
 * The third documented recovery — you cannot do this at all — is the two staff
 * refusals, and neither survives to here. The sender-is-staff case is caught at
 * step 1 from the token, before four steps of work; the recipient-is-staff case
 * cannot be composed, because search excludes staff from the results this
 * partner was chosen from. If one ever did arrive it lands in `repick`, whose
 * "choose someone else" is the correct move for it anyway.
 *
 * Not to be confused with `AnswerRecovery` in `./trade-review`, which
 * classifies a refused *answer* to a trade that already exists. Two of the
 * three members coincide and the third does not, in both directions.
 */
export type SendRecovery = "board" | "repick" | "retry";

/**
 * Deliberately switching on `status`, never on the message. Those sentences are
 * the server's to reword; a client that branches on their text breaks silently
 * the first time one is improved.
 */
export function sendRecoveryFor(error: unknown): SendRecovery {
  if (!(error instanceof ApiError)) return "retry";
  if (error.status === 409) return "board";
  if (error.status === 400 || error.status === 404) return "repick";
  return "retry";
}
