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
 * The string to show for a failure, given the copy to fall back on.
 *
 * An `ApiError`'s message is a sentence the server wrote for a human and is
 * rendered verbatim — the routes answer `{ error }` and those strings are
 * user-facing copy (AGENTS.md, "Conventions"). Anything else is a rejected
 * fetch whose message is a diagnostic ("Network request failed", a URL, a
 * native stack) and must never reach a screen, so it becomes copy instead.
 *
 * The same distinction `TradingBoard` makes, lifted out because four screens
 * now need it and each one has a different sentence to fall back on.
 */
export function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
