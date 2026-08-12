import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import {
  GRID_COLUMNS,
  GRID_GAP,
  GRID_PADDING,
  PartnerCardTile,
  SelectableCell,
  useGridCellWidth,
} from "../../../src/components/CardPicker";
import { PrimaryButton } from "../../../src/components/PrimaryButton";
import {
  ActionGap,
  WizardFooter,
  WizardNotice,
  WizardScreen,
} from "../../../src/components/WizardScreen";
import { api } from "../../../src/api";
import { copy, fill } from "../../../src/copy";
import { colors } from "../../../src/theme";
import type { OwnedCard, Trade } from "../../../src/types";
import {
  chooseRequested,
  messageFor,
  reconcileRequested,
  useTradeDraft,
} from "../../../src/wizard";

/**
 * TH-11, step 3 of 4 — pick the card you are asking for.
 *
 * Backed by `GET /users/:id/cards`, which returns everything the partner holds
 * at `quantity >= 1`, ordered by card number. Collections are public in a
 * trading app by design (DESIGN.md), so this needs no permission the partner
 * has to grant.
 *
 * **The card being offered is suppressed here.** By this step the offer is
 * known, and `POST /trades` refuses a trade with the same card on both sides —
 * so leaving it in the grid would be offering a choice whose only outcome is a
 * refusal four screens later. Removing it turns a documented failure into a
 * case that cannot be expressed. Its other half lives in the draft store:
 * going back to step 2 afterwards and picking that same card clears the
 * request, because suppression here cannot see an edit made behind it.
 *
 * **Cards already offered are marked and disabled, not suppressed.** `POST
 * /trades` refuses a second pending offer of the same card to the same person
 * for the same card of theirs, so those are the choices whose only outcome is a
 * 409 at the end of the wizard. They are still drawn, for two reasons. A card
 * the viewer can see in the partner's collection and cannot find in this grid
 * is a disappearance with no explanation; and removing them can empty the grid,
 * which would invent a third dead end — with its own screen and its own copy —
 * for a state the two below already read badly against. Marked, the grid keeps
 * its shape and the chip says why.
 *
 * Two dead ends, and they are genuinely different. A partner who owns nothing
 * is reachable — search returns anyone who is not staff, whatever their
 * collection — and the way out is a different partner. A partner whose only
 * card is the one being offered is the suppression's own doing, and the way out
 * is a different offer. Telling the second person to go find somebody else
 * would be sending them away from a trade that works.
 */
export default function ChooseRequest() {
  const router = useRouter();
  const draft = useTradeDraft();

  // Up here for the same reason as step 2: the grid is rendered from a function
  // with early returns for loading, error and two different empty states.
  const cellWidth = useGridCellWidth();
  const partnerId = draft.partner?.id ?? null;
  const offeredId = draft.offered?.id ?? null;

  const [theirs, setTheirs] = useState<OwnedCard[] | null>(null);
  // Card ids the viewer already holds, for the "you have one of these" marker.
  // `null` means the cross-reference did not load, which is not an error state:
  // it degrades to an unmarked grid.
  const [alsoOwned, setAlsoOwned] = useState<Set<string> | null>(null);
  // The viewer's whole board, for the "you already offered this" marker. Kept
  // whole and filtered at render for the reason `pickable` is: the offered card
  // is half the duplicate rule and step 2 can change it behind this screen.
  // `null` is the same non-error as `alsoOwned`'s — nothing marked.
  const [board, setBoard] = useState<Trade[] | null>(null);
  // Only ever true before the first answer; a refresh swaps data in silently.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Focus can fire again before the previous load answers.
  const runId = useRef(0);

  const load = useCallback(async () => {
    if (partnerId === null) return;
    const id = ++runId.current;
    setError(null);
    try {
      // Their collection is the screen; the viewer's own collection and board
      // are garnishes on it, so only the first is allowed to fail the load.
      // Each of the other two swallows its own rejection into `null` before
      // `Promise.all` can see it — otherwise a flaky second or third request
      // would blank a first one that arrived fine.
      //
      // That applies to the board in particular: the duplicate marker is a
      // convenience and not the enforcement. `POST /trades` is where a duplicate
      // is actually refused, by a partial unique index the client cannot see, so
      // a board that never arrives costs nothing that was not already true —
      // nothing is marked, and the 409 catches it at the send exactly as it does
      // today.
      const [cards, mine, trades] = await Promise.all([
        api.userCards(partnerId),
        api
          .cards()
          .then((all) => all.filter((c) => c.owned).map((c) => c.id))
          .catch(() => null),
        api.trades().catch(() => null),
      ]);
      if (id !== runId.current) return;
      setTheirs(cards);
      setAlsoOwned(mine === null ? null : new Set(mine));
      setBoard(trades);
      // Their collection can move between this screen and the send. Dropping a
      // selection they no longer hold is what stops the review step's "change
      // what you're asking for" recovery from returning to the same refusal.
      reconcileRequested(new Set(cards.map((c) => c.id)));
    } catch (e) {
      if (id !== runId.current) return;
      setTheirs(null);
      setError(messageFor(e, copy.wizard.request.errorBody));
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }, [partnerId]);

  // On focus, not just on mount — see the note in the load above.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Retrying from the error state has no grid to sit behind, so it puts the
  // screen back into its first-load state rather than leaving a dead button.
  const retry = useCallback(() => {
    setLoading(true);
    load();
  }, [load]);

  // Nothing to draw without both earlier answers, and this screen cannot supply
  // either. Step 1 is where the flow restarts from.
  if (draft.partner === null || draft.offered === null || offeredId === null) {
    return <Redirect href="/trade/new" />;
  }

  const partner = draft.partner;
  // The whole point of this step's suppression. Computed from the live draft
  // rather than at load time, so coming back after changing the offer re-filters
  // without refetching their collection.
  const pickable = (theirs ?? []).filter((c) => c.id !== offeredId);

  // The cards this exact offer has already been made for.
  //
  // The index behind the 409 is on all four of `(fromUserId, toUserId,
  // offeredCardId, requestedCardId)` and is partial on `PENDING`, so this
  // predicate is all four columns and the status, and each clause is load
  // bearing. Dropping `offeredCard` would block a card of theirs the viewer had
  // asked for with a *different* card of their own, which is a distinct trade
  // the server accepts. Dropping `toUser` would block it across every partner.
  // Dropping `direction` would block what somebody offered *the viewer*, which
  // is not this constraint at all. And answered trades are outside the index on
  // purpose: re-sending an identical offer after a decline is legal, so
  // `ACCEPTED` and `DECLINED` must never mark anything.
  //
  // Computed from the live draft rather than at load time, for the reason
  // `pickable` is — going back to step 2 and changing the offer changes which
  // of these cards are duplicates, and does not refetch the board.
  //
  // Not handled, and stated rather than assumed: a card selected while it was
  // legal and made a duplicate afterwards, by changing the offer behind this
  // screen, stays selected and draws the chip. `chooseOffered` clears a
  // colliding selection but knows nothing about the board, and clearing it here
  // means committing to the store during a render. That path ends at the same
  // 409 it ends at today, so this leaves it no worse and marks it besides.
  const alreadyOffered = new Set(
    (board ?? [])
      .filter(
        (t) =>
          t.status === "PENDING" &&
          t.direction === "sent" &&
          t.toUser.id === partnerId &&
          t.offeredCard.id === offeredId
      )
      .map((t) => t.requestedCard.id)
  );

  // One chip, so the two markers are exclusive and the blocking one wins. A
  // card can be both already-offered and already-owned, and "Owned" is a note
  // on a card that can still be picked, while this one is the only thing on
  // screen explaining why the card underneath it does not respond.
  const markerFor = (cardId: string) => {
    if (alreadyOffered.has(cardId)) return copy.wizard.request.alreadyOffered;
    if (alsoOwned?.has(cardId)) return copy.wizard.request.alsoOwned;
    return null;
  };

  const pickSomeoneElse = () => router.dismissTo("/trade/new");

  const body = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.black} />
        </View>
      );
    }

    if (theirs === null) {
      // Includes the 404 for a partner who no longer exists, whose sentence the
      // server wrote and which is rendered verbatim above these buttons. That
      // is also why "choose someone else" sits beside retry: retrying a 404 is
      // the one recovery guaranteed not to work.
      return (
        <WizardNotice
          icon="cloud-offline-outline"
          title={copy.wizard.request.errorTitle}
          body={error ?? copy.wizard.request.errorBody}
        >
          <PrimaryButton label={copy.wizard.retry} onPress={retry} />
          <ActionGap />
          <PrimaryButton
            label={copy.wizard.request.emptyAction}
            variant="outline"
            onPress={pickSomeoneElse}
          />
        </WizardNotice>
      );
    }

    if (theirs.length === 0) {
      // They own nothing. A dead end for this partner only — the card chosen in
      // step 2 is kept, which is what the copy promises.
      return (
        <WizardNotice
          icon="person-outline"
          title={copy.wizard.request.empty}
          body={copy.wizard.request.emptyBody}
        >
          <PrimaryButton label={copy.wizard.request.emptyAction} onPress={pickSomeoneElse} />
        </WizardNotice>
      );
    }

    if (pickable.length === 0) {
      // They own exactly one card and it is the one being offered. Different
      // dead end, different way out: change the offer, not the person.
      return (
        <WizardNotice
          icon="swap-horizontal"
          title={copy.wizard.request.onlyOffered.title}
          body={copy.wizard.request.onlyOffered.body}
        >
          <PrimaryButton
            label={copy.wizard.request.onlyOffered.action}
            onPress={() => router.back()}
          />
          <ActionGap />
          <PrimaryButton
            label={copy.wizard.request.emptyAction}
            variant="outline"
            onPress={pickSomeoneElse}
          />
        </WizardNotice>
      );
    }

    return (
      <FlatList
        data={pickable}
        keyExtractor={(c) => c.id}
        numColumns={GRID_COLUMNS}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <SelectableCell selected={draft.requested?.id === item.id} width={cellWidth}>
            <PartnerCardTile
              card={item}
              quantity={item.quantity}
              marker={markerFor(item.id)}
              disabled={alreadyOffered.has(item.id)}
              onPress={() => chooseRequested(item)}
            />
          </SelectableCell>
        )}
      />
    );
  };

  return (
    <WizardScreen
      step={3}
      title={fill(copy.wizard.request.title, { username: partner.username })}
    >
      {body()}
      {!loading && pickable.length > 0 && (
        <WizardFooter>
          <PrimaryButton
            label={copy.wizard.continue}
            disabled={draft.requested === null}
            onPress={() => router.push("/trade/new/review")}
          />
        </WizardFooter>
      )}
    </WizardScreen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  // Padding and gap come from `CardPicker`, because `useGridCellWidth`
  // subtracts exactly these to size a cell. Two grids and one hook all
  // reading one set of numbers is what stops a cell from being measured
  // against padding it is not actually sitting in.
  grid: { paddingHorizontal: GRID_PADDING, paddingBottom: 24 },
  row: { gap: GRID_GAP, marginBottom: GRID_GAP },
});
