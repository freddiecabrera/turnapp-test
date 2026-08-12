// Every user-facing string in the trading feature, in one place.
//
// **These values are provisional placeholders and are owned by the repo owner.**
// They are deliberately flat and literal — they say what the slot must
// communicate, not how the product should sound. Rewriting them is a one-file
// edit: no component reads a string from anywhere else, so changing wording
// here requires no code change and no knowledge of which screen renders what.
//
// Each entry carries a comment stating its CONSTRAINT — what it has to get
// across, roughly how long it can be, and which values (if any) it
// interpolates. Honour the constraint and the screen keeps working; ignore it
// and a row can overflow or a sentence can lose the name it was about.
//
// Interpolation uses `{token}` placeholders and the `fill` helper at the bottom
// of this file, rather than functions, so every value stays an editable string
// literal. A rewritten string that drops a token renders without it — the
// wording degrades, nothing throws.
//
// One rule this file cannot enforce on its own: **API error strings are already
// user-facing copy.** `src/api.ts` throws the server's `{ error }` message
// verbatim, and the server writes those for humans (see AGENTS.md,
// "Conventions"). Render them as-is. Do not add entries here that restate,
// wrap, or map them — the only error strings below are for failures the server
// never got to describe.

export const copy = {
  /**
   * Labels shared by every trading surface. `TradeCards` renders these, so the
   * board, the wizard's review step and the approve/decline screen all show the
   * same two words.
   */
  trade: {
    // CONSTRAINT: labels the card the viewer LOSES. Must read correctly for
    // both parties — the stored columns are sender-relative, so this can never
    // be "offered card" or "requested card". Very short; sits above a card
    // thumbnail. No interpolation.
    give: "You give",
    // CONSTRAINT: labels the card the viewer RECEIVES. Same rules as `give`.
    // Very short. No interpolation.
    get: "You get",
    // CONSTRAINT: shown in place of a card's name when the API sent no name.
    // Rare. Very short. No interpolation.
    unnamedCard: "Card",
  },

  /** TH-10 — the trading board behind the `trading board` pill. */
  board: {
    // CONSTRAINT: the filter pills, reusing the collectibles pill row. Each must
    // fit a third of the screen width at 12pt bold — keep to one or two short
    // words, lowercase to match the existing pills. No interpolation.
    filters: {
      all: "all",
      incoming: "incoming",
      outgoing: "outgoing",
    },

    // CONSTRAINT: the count of incoming trades still awaiting the viewer's
    // answer. Interpolates {count}, always >= 1 (hidden at zero). This is a
    // PENDING count, not an unread one — the API has no seen/read field, so it
    // stays lit until the trade is answered. Do not word it as "new" or
    // "unread". One short line.
    pendingCount: "{count} waiting on you",

    // CONSTRAINT: per-row status line. Picked by direction AND status, because
    // one stored row means opposite things to the two parties. One short line
    // each, sits under the card pair. No interpolation.
    status: {
      sent: {
        // The viewer offered; the other person has not answered yet.
        pending: "Waiting on them.",
        // The other person accepted; the cards have moved.
        accepted: "They accepted.",
        // The other person declined; nothing moved.
        declined: "They declined.",
      },
      received: {
        // Someone offered the viewer a trade and is waiting on them.
        pending: "Waiting on you.",
        // The viewer accepted; the cards have moved.
        accepted: "You accepted.",
        // The viewer declined; nothing moved.
        declined: "You declined.",
      },
    },

    // CONSTRAINT: shown on a PENDING row when the API says `fulfillable` is
    // exactly `false` — one side no longer owns the card they named, so the
    // trade can never complete. Must NOT read as an error or as someone's
    // fault, and must not promise that anything will be cleaned up: the row
    // stays PENDING forever unless answered. One short line. No interpolation.
    unfulfillable: "This can no longer be completed.",

    // CONSTRAINT: shown on every `sent` row. A sent trade has no action at all —
    // there is no cancel or withdraw endpoint and the sender cannot decline
    // their own offer. This exists so an inert row reads as deliberately inert
    // rather than as a broken button. Very short. No interpolation.
    sentInert: "No action available.",

    // CONSTRAINT: the viewer has never been in a trade at all. Offers the way
    // in. `title` one short line, `body` at most two, `action` a button label of
    // two or three words. No interpolation.
    emptyNever: {
      title: "No trades yet.",
      body: "Trades you send or receive will show up here.",
      action: "Start a trade",
    },

    // CONSTRAINT: the viewer HAS trades, but none match the active filter. Must
    // point at the filter as the reason — telling this person "no trades yet"
    // would be false. Interpolates nothing; the filter name is rendered
    // separately. `action` clears the filter, so it must not read as "make a
    // trade". Short.
    emptyFiltered: {
      title: "Nothing here.",
      body: "No trades match this filter.",
      action: "Show all",
    },

    // CONSTRAINT: the board could not load and there is nothing cached to show.
    // `body` is used ONLY when the failure produced no server message — a
    // dropped connection, a timeout. When the server did answer with an error,
    // that sentence is rendered instead of this one, verbatim. `retry` and
    // `action` are button labels; `action` still offers the way into a new
    // trade, because the entry point has to work from every state.
    error: {
      title: "Couldn't load trades.",
      body: "Check your connection and try again.",
      retry: "Try again",
      action: "Start a trade",
    },

    // CONSTRAINT: a refresh failed but rows from an earlier load are still on
    // screen. Must make clear the list is stale WITHOUT implying it is empty or
    // wrong. Sits in a thin banner above the list, so: one short line, no
    // interpolation.
    refreshFailed: "Couldn't refresh. Showing the last update.",

    // CONSTRAINT: the button that opens the create-trade flow, shown above the
    // populated list. Two or three words. No interpolation.
    startTrade: "Start a trade",
  },

  /**
   * TH-11 — the create-trade wizard (three pushed steps plus a review).
   *
   * Slots only. Values are placeholders and several are certainly missing —
   * add entries here rather than hardcoding a string in the wizard, and rather
   * than restructuring this object.
   */
  wizard: {
    // Step 1 — pick a person. CONSTRAINT: `searchPlaceholder` goes inside the
    // input and must hint that BOTH a username and a numeric user ID work.
    // `empty` shows when a search returned nothing; `prompt` shows before the
    // first search. Short lines. No interpolation.
    partner: {
      title: "Choose a partner",
      searchPlaceholder: "Username or ID",
      prompt: "Search for someone to trade with.",
      empty: "No one found.",
    },

    // Step 2 — pick the card you are giving. CONSTRAINT: `empty` covers a user
    // who owns nothing to offer. Short. No interpolation.
    offer: {
      title: "Choose your card",
      empty: "You have no cards to offer.",
    },

    // Step 3 — pick the card you are asking for, from their collection.
    // CONSTRAINT: `title` interpolates {username}; keep the token so the step
    // says whose collection this is. `empty` covers a partner who owns nothing.
    request: {
      title: "Choose a card from {username}",
      empty: "They have no cards to trade.",
    },

    // Review + submit. CONSTRAINT: `confirm` is the button that actually
    // creates the trade — it must read as sending an offer, not as completing a
    // swap, because nothing moves until the other person accepts. `success`
    // must say the same. Short.
    review: {
      title: "Review your offer",
      confirm: "Send offer",
      cancel: "Cancel",
      success: "Offer sent.",
    },
  },

  /**
   * TH-12 — the approve/decline screen (one pushed screen).
   *
   * Slots only, same rules as `wizard`. Note there is no `GET /trades/:id`: the
   * screen reads the whole board and selects its trade by id, so it has a real
   * loading state, a real not-found state, and slots for both below.
   */
  review: {
    // CONSTRAINT: screen title. Short. No interpolation.
    title: "Trade offer",

    // CONSTRAINT: names who sent the offer. Interpolates {username} — keep the
    // token. One short line.
    from: "From {username}",

    // CONSTRAINT: the same line for a trade the viewer SENT, which this screen
    // shows read-only — the board never opens one, so it is reached by a link.
    // Interpolates {username}; keep the token. One short line.
    to: "To {username}",

    // CONSTRAINT: the two actions. `accept` swaps the cards immediately;
    // `decline` moves nothing. Button labels, two words at most.
    accept: "Accept",
    decline: "Decline",

    // CONSTRAINT: confirmation before accepting, since the swap is immediate
    // and there is no undo. `body` may interpolate {give} and {get} card names.
    confirmAccept: {
      title: "Accept this trade?",
      body: "You'll give {give} and get {get}. This can't be undone.",
      confirm: "Accept",
      cancel: "Cancel",
    },

    // CONSTRAINT: confirmation before declining. Declining is final — the
    // sender would have to send a new offer — but nothing moves. Short.
    confirmDecline: {
      title: "Decline this trade?",
      body: "Nothing will be traded. This can't be undone.",
      confirm: "Decline",
      cancel: "Cancel",
    },

    // CONSTRAINT: shown when `fulfillable` is exactly `false` — one side no
    // longer owns their card, so accepting would be refused by the server. The
    // accept action stays visible and disabled in this state, so this line has
    // to explain why it cannot be pressed. This is the SIDE-NEUTRAL wording,
    // used when the screen cannot tell whose card went missing; the two
    // side-precise lines below replace it when it can. Two lines at most. No
    // interpolation.
    unfulfillable: "This trade can no longer be completed.",

    // CONSTRAINT: the same fact as `unfulfillable`, once the screen knows which
    // side is broken. `fulfillable` is one boolean over both ownership checks,
    // so the side is inferred from the viewer's own collection — see
    // `src/trade-review.ts`. These are not restatements of an API error: `GET
    // /trades` sends the bare boolean and never words it. Decline still works
    // in both cases, so neither may read as a dead end. Two lines at most each.
    // No interpolation.
    unfulfillableYou: "You no longer have the card they asked for.",
    unfulfillableThem: "They no longer have the card they offered.",

    // CONSTRAINT: the viewer's own collection, joined in after the trade is
    // already on screen. `lastCopy` marks the card being given away when the
    // viewer holds exactly one; `alreadyOwn` marks the card being received when
    // the viewer already holds at least one, and interpolates {count} (always
    // >= 1) — keep the token. Both sit under a card thumbnail, so one short
    // line each. Neither is a warning: trading a last copy is a legitimate
    // thing to do and this only makes sure it is not done unknowingly.
    ownership: {
      lastCopy: "Your last copy.",
      alreadyOwn: "You already own {count}.",
    },

    // CONSTRAINT: sits under the two actions while the trade can still be
    // answered. Says the offer cannot be withdrawn — there is no cancel
    // endpoint and decline refuses anyone but the recipient — so answering it
    // is the only thing that ever ends it. Must not read as pressure or as a
    // deadline. Two short lines at most. No interpolation.
    onlyYouCanAnswer: "Only you can answer this. The sender can't take it back.",

    // CONSTRAINT: shown under the spinner while the trade is being looked up on
    // entry. Two words at most. No interpolation.
    loading: "Loading trade...",

    // CONSTRAINT: the board loaded and this trade was not on it. Reachable from
    // a stale board or a link to someone else's trade, and the API cannot tell
    // those two apart — so this must not accuse anyone or claim the trade
    // exists. `title` one line, `body` at most two. No interpolation.
    notFound: {
      title: "Trade not found.",
      body: "This trade isn't on your board.",
    },

    // CONSTRAINT: the trade could not be loaded at all. `body` is used ONLY
    // when the failure produced no server message — a dropped connection, a
    // timeout; when the server did answer with an error, that sentence is
    // rendered instead of this one, verbatim. `retry` is a button label.
    loadError: {
      title: "Couldn't load this trade.",
      body: "Check your connection and try again.",
      retry: "Try again",
    },

    // CONSTRAINT: the way out of every finished state and every dead end. The
    // board is where a trade's current truth lives, which is what this points
    // at. Button label, three words at most. No interpolation.
    backToBoard: "Back to trades",

    // CONSTRAINT: outcome confirmations after the server answers. Short.
    accepted: "Trade accepted.",
    declined: "Trade declined.",

    // CONSTRAINT: the sub-lines under those two. `acceptedBody` may interpolate
    // {give} and {get} card names — the cards have already moved by the time it
    // is shown, so it must read as done, not as in progress. `declinedBody`
    // must say that nothing moved. One or two lines each.
    acceptedBody: "You gave {give} and got {get}.",
    declinedBody: "Nothing was traded.",

    // CONSTRAINT: the full-screen result when an answer was refused. `title`
    // heads all of them, and the server's own sentence is rendered underneath
    // it verbatim — it is already user-facing copy and says more than any of
    // these can. `body` replaces that sentence ONLY when the failure never
    // reached the server.
    failed: {
      title: "That didn't go through.",
      body: "Check your connection and try again.",

      // CONSTRAINT: button label. Offered only for failures a second attempt
      // could actually clear — never for a trade that has already been
      // answered, where retrying is guaranteed to fail the same way.
      retry: "Try again",

      // CONSTRAINT: the recovery when accepting was refused because one of the
      // cards is gone. The trade is still pending and decline never checks
      // ownership, so this is the one answer guaranteed to work. `action` is a
      // button label. `hint` sits under it and must carry what the decline
      // confirmation would have said — nothing is traded, and it is final —
      // because this button acts on the first press. Two lines at most.
      declineInstead: "Decline instead",
      declineInsteadHint: "Nothing will be traded, and declining always works. This is final.",
    },
  },
} as const;

/**
 * Substitute `{token}` placeholders in a copy string.
 *
 * Exists so every value above can stay a plain editable literal instead of a
 * function — the repo owner rewrites wording without touching a call site.
 *
 * A token with no matching value is left in place rather than replaced with
 * "undefined", and a value with no matching token is simply unused. Both are
 * wording mistakes, and neither is worth throwing over in a render path: the
 * screen still draws, and the wrong-looking string is its own bug report.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) =>
    key in values ? String(values[key]) : token
  );
}
