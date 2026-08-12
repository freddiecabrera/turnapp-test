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
    // CONSTRAINT: the step counter drawn on all four screens. Interpolates
    // {step} and {total} — {total} is 4 and comes from the code, so a rewrite
    // that hardcodes a number will lie the day a step is added or removed. One
    // very short line, sits above the screen title.
    progress: "Step {step} of {total}",

    // CONSTRAINT: the accessibility label of the bare back chevron every step
    // draws for itself. Never rendered as visible text, so length is free, but
    // it must say where back goes: to the previous step, and out of the wizard
    // from step 1. No interpolation.
    back: "Go back",

    // CONSTRAINT: the button that moves from step 2 to step 3, and from step 3
    // to the review. Both steps use this one label, so it must read correctly
    // after picking either card. It is disabled until something is selected, so
    // it must not itself say "pick a card". Two words at most.
    continue: "Continue",

    // CONSTRAINT: the button that re-runs a failed load, on all three steps.
    // Two words at most. No interpolation.
    retry: "Try again",

    // CONSTRAINT: the caller is a staff account, and `POST /trades` refuses
    // those before it checks anything else — so the whole wizard is a dead end
    // for them and this is shown in place of step 1 rather than after four
    // steps of work. There is no action that fixes it; the only way out is
    // back. `title` one short line, `body` at most two. No interpolation.
    blocked: {
      title: "Trading isn't available on this account.",
      body: "Staff accounts can't send or receive trades.",
    },

    // Step 1 — pick a person.
    partner: {
      title: "Choose a partner",
      // CONSTRAINT: goes inside the input. Must hint that BOTH a username and a
      // numeric user ID work — but usernames match on any part of the name
      // while an ID must be typed in full and exactly (no prefixes, no leading
      // zeros), so this must not imply that a partial ID finds anyone. Has to
      // fit one line of a text field. No interpolation.
      searchPlaceholder: "Username or ID",
      // CONSTRAINT: nothing has been typed yet. This is the idle state, NOT a
      // no-results state — the server never ran a query — so it must read as an
      // invitation rather than as a failure. One short line. No interpolation.
      prompt: "Search for someone to trade with.",
      // CONSTRAINT: a search ran and matched nobody. Must not read as an error.
      // One short line. No interpolation.
      empty: "No one found.",
      // CONSTRAINT: sits under `empty` and explains why a search that looks
      // right can still match nobody: usernames match on any part, an ID has to
      // be exact. This is the only place the exact-ID rule is stated, so it
      // carries it. At most two lines. No interpolation.
      emptyHint: "Usernames match on any part. An ID has to be exact.",
      // CONSTRAINT: the result list is capped at 20 by the server, with no
      // pagination and no total count — so this may NOT say how many people
      // matched or promise that more can be loaded. It interpolates {count},
      // which is the number shown, not the number that exist. Its only job is
      // to tell someone whose person is missing to type more. One short line.
      capped: "Showing the first {count}. Type more to narrow it down.",
      // CONSTRAINT: the search request itself failed. `body` is used ONLY when
      // the failure produced no server message — a dropped connection, a
      // timeout; when the server did answer with an error, that sentence is
      // rendered instead, verbatim. `title` one short line, `body` at most two.
      errorTitle: "Couldn't search.",
      errorBody: "Check your connection and try again.",
      // CONSTRAINT: how a person's ID number is drawn beside their username in
      // a result row. Interpolates {id} — keep the token. This is a format, not
      // a sentence: a couple of characters around the number at most.
      idFormat: "#{id}",
    },

    // Step 2 — pick the card you are giving, from your own collection.
    offer: {
      title: "Choose your card",
      // CONSTRAINT: a hard dead end — a new account owns nothing, so there is
      // no card to offer and no other step can fix it. `empty` is the title,
      // `emptyBody` says how cards are acquired, and `emptyAction` is a button
      // that leaves the wizard for the scan flow. Nothing here may suggest
      // going back a step. Short.
      empty: "You have no cards to offer.",
      emptyBody: "Scan a card to start your collection, then come back.",
      emptyAction: "Go to scan",
      // CONSTRAINT: your collection failed to load. Same `body` rule as
      // `partner.errorBody` — only used when the server described nothing.
      errorTitle: "Couldn't load your cards.",
      errorBody: "Check your connection and try again.",
    },

    // Step 3 — pick the card you are asking for, from their collection.
    request: {
      // CONSTRAINT: interpolates {username} — keep the token, it is what says
      // whose collection is on screen. One line, and the name can be long, so
      // keep the wording around it short.
      title: "Choose a card from {username}",
      // CONSTRAINT: this partner owns nothing. Search returns anyone who isn't
      // staff regardless of collection size, so an empty person is selectable
      // and this is reachable. A dead end for this partner only — `emptyAction`
      // goes back to the search, and must NOT read as abandoning the trade,
      // because the card you picked to give is kept. Short.
      empty: "They have no cards to trade.",
      emptyBody: "Pick someone else and your card stays selected.",
      emptyAction: "Choose someone else",
      // CONSTRAINT: they own exactly one card and it is the one you are already
      // offering, so suppressing it emptied the list. Distinct from `empty`:
      // this person does have a card, it just cannot be both sides of one
      // trade. `action` goes back to step 2 to give something else. Short.
      onlyOffered: {
        title: "That's the only card they have.",
        body: "It's the one you're offering, and a trade can't have the same card on both sides.",
        action: "Change what you're giving",
      },
      // CONSTRAINT: their collection failed to load. Reachable as a 404 if the
      // account disappeared between step 1 and here, in which case the server's
      // own sentence is rendered instead of `errorBody`. Short.
      errorTitle: "Couldn't load their cards.",
      errorBody: "Check your connection and try again.",
      // CONSTRAINT: a badge on a card in THEIR collection that you already own
      // a copy of, so someone completing a set can skip it. Purely
      // informational — the card is still selectable. One word, fits inside a
      // small pill on a card thumbnail. No interpolation.
      alsoOwned: "Owned",
    },

    // Review + submit.
    review: {
      title: "Review your offer",
      // CONSTRAINT: names who the offer is going to. Interpolates {username} —
      // keep the token. One short line.
      to: "To {username}",
      // CONSTRAINT: `confirm` is the button that actually creates the trade —
      // it must read as sending an offer, not as completing a swap, because
      // nothing moves until the other person accepts. `cancel` abandons the
      // whole wizard, not one step. Short.
      confirm: "Send offer",
      cancel: "Cancel",
      // CONSTRAINT: the offer was created. `success` must say the same thing
      // `confirm` did — an offer was sent, no cards have moved. `successBody`
      // says what happens next and must not promise a timescale or an outcome.
      // `successAction` is a button back to the trading board. Short.
      success: "Offer sent.",
      successBody: "Nothing moves until they accept. You'll see it on your board.",
      successAction: "Back to your board",

      // CONSTRAINT: sending failed. Thirteen failures are documented on `POST
      // /trades` and they collapse into three recoveries, which is why there
      // are three sets of buttons here rather than thirteen messages. The
      // server's own sentence is rendered above them verbatim whenever it sent
      // one — these are only the labels on the ways out.
      //
      // `body` is used ONLY when the failure produced no server message.
      // `retry` re-sends unchanged, for a failure that may not repeat.
      // `changeOffer` / `changeRequest` / `changePartner` go back to steps 2, 3
      // and 1 respectively, and cover every failure that means "something you
      // picked is no longer true". `board` covers the one failure that means
      // the offer already exists, so the board is where it is. All are button
      // labels: three or four words at most.
      error: {
        title: "Couldn't send that offer.",
        body: "Check your connection and try again.",
        retry: "Try again",
        changeOffer: "Change what you're giving",
        changeRequest: "Change what you're asking for",
        changePartner: "Choose someone else",
        board: "Go to your board",
      },
    },
  },

  /**
   * TH-12 — the approve/decline screen (one pushed screen).
   *
   * Slots only, same rules as `wizard`. Note there is no `GET /trades/:id`, so
   * this screen is handed its trade rather than fetching one.
   */
  review: {
    // CONSTRAINT: screen title. Short. No interpolation.
    title: "Trade offer",

    // CONSTRAINT: names who sent the offer. Interpolates {username} — keep the
    // token. One short line.
    from: "From {username}",

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
    // accept action is hidden in this state, so this line has to explain why
    // there is nothing to press. Two lines at most. No interpolation.
    unfulfillable: "This trade can no longer be completed.",

    // CONSTRAINT: outcome confirmations after the server answers. Short.
    accepted: "Trade accepted.",
    declined: "Trade declined.",
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
