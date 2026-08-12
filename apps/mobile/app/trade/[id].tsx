import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { TradeCards } from "../../src/components/TradeCards";
import {
  giveAndGet,
  isActionable,
  isUnfulfillable,
  partnerOf,
  statusLine,
  tradeDateLabel,
} from "../../src/trade";
import {
  brokenSide,
  finishedTrade,
  ownershipOf,
  recoveryFor,
  type Answer,
  type Recheck,
  type Recovery,
} from "../../src/trade-review";
import { api, messageFor } from "../../src/api";
import { copy, fill } from "../../src/copy";
import { colors, fonts, radius } from "../../src/theme";
import type { Card, CardWithOwnership, Trade } from "../../src/types";

/**
 * TH-12 — review an incoming trade, then approve or decline it.
 *
 * A pushed screen rather than a sheet, because the board already pushes here
 * and a route survives a deep link later. The root `Stack` sets
 * `headerShown: false` globally, so this draws its own bare back control the
 * way `card/[id].tsx` does.
 *
 * **There is no `GET /trades/:id`.** The API has `GET /trades` and the two
 * answers, so this screen reads the whole board and selects by id. Serialising
 * a trade through route params would have avoided the request; it would also
 * have made the screen unreachable from a link and left it with no honest
 * loading or not-found state. The read costs one request and buys both.
 *
 * **The inversion this screen is built around.** `direction === "received"`
 * means the viewer *gives* `requestedCard` and *gets* `offeredCard` — the
 * stored columns are sender-relative (DESIGN.md, "Column names are
 * sender-relative"). Nothing here re-derives that; `giveAndGet` owns it, and no
 * label ever reads "requested card".
 *
 * **Refreshing after an answer is already handled.** An accept moves cards, so
 * the board and the collection are both stale afterwards — and both reload on
 * focus (`TradingBoard` and `(tabs)/cards.tsx` each run their load in a
 * `useFocusEffect`), which fires when this screen pops. There is nothing to
 * plumb, and a store or an event bus for it would be inventing a mechanism the
 * app already has.
 */

/** Which of the screen's mutually exclusive states is on show. */
type Phase =
  | { kind: "loading" }
  /** The board could not be read at all. `message` is a server sentence or copy. */
  | { kind: "loadFailed"; message: string }
  /** The board loaded and this id was not on it. */
  | { kind: "notFound" }
  /** The trade, with its actions if it can still be answered. */
  | { kind: "review" }
  /** The same trade, with one action's confirmation in place of the two buttons. */
  | { kind: "confirm"; answer: Answer }
  /** Answered — by this screen, or elsewhere and discovered by the re-read. */
  | { kind: "outcome" }
  /** An answer was refused. `recovery` decides what is offered next. */
  | { kind: "failed"; answer: Answer; message: string; recovery: Recovery };

/** A card's name, or the placeholder `TradeCards` uses for the same gap. */
function nameOf(card: Card): string {
  return card.name || copy.trade.unnamedCard;
}

/** Re-read the board and pick this trade out of it. Never throws. */
async function recheckBoard(id: string): Promise<Recheck> {
  try {
    const board = await api.trades();
    return { ok: true, trade: board.find((t) => t.id === id) ?? null };
  } catch {
    // The re-read is a diagnostic step on a path that has already failed.
    // Failing it narrows what can be offered next; it is not a second error to
    // report on top of the first.
    return { ok: false };
  }
}

export default function TradeReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [trade, setTrade] = useState<Trade | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  /**
   * The viewer's own collection, joined against the trade's two cards.
   *
   * `null` until it arrives, and the screen draws without it — the trade is
   * what someone opened this for, and holding it behind a second request would
   * trade an instant render for two annotations. Everything that reads this
   * treats `null` as "no answer" rather than as zero.
   */
  const [cards, setCards] = useState<CardWithOwnership[] | null>(null);

  /**
   * The answer currently in flight, and the whole of the lock.
   *
   * Accept and decline race each other server-side: the claim in each is an
   * `updateMany` on `status: "PENDING"`, so a user who fires both gets one 200
   * and one 409. Every action button on this screen is disabled while this is
   * set, which is why it is one piece of state rather than a flag per button.
   */
  const [busy, setBusy] = useState<Answer | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setPhase({ kind: "notFound" });
      return;
    }
    setPhase({ kind: "loading" });
    try {
      const board = await api.trades();
      const found = board.find((t) => t.id === id);
      if (!found) {
        setPhase({ kind: "notFound" });
        return;
      }
      setTrade(found);
      setPhase({ kind: "review" });
    } catch (e) {
      setPhase({ kind: "loadFailed", message: messageFor(e, copy.review.loadError.body) });
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // The ownership join, fired alongside the trade rather than after it. A
  // failure is swallowed on purpose: it costs two annotations, and there is
  // nothing the viewer would do about it that answering the trade doesn't do.
  useEffect(() => {
    let alive = true;
    api
      .cards()
      .then((all) => {
        if (alive) setCards(all);
      })
      .catch(() => {
        /* the join is an enhancement; the screen is complete without it */
      });
    return () => {
      alive = false;
    };
  }, []);

  const goBack = useCallback(() => {
    // A deep link can land here with nothing beneath it, and `back()` is a
    // no-op with an empty history — which would leave the only way off this
    // screen dead.
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/cards");
  }, [router]);

  /**
   * Send an answer, and decide what the screen says next.
   *
   * Both endpoints return the full updated `Trade` — status flipped,
   * `respondedAt` stamped — so the outcome is rendered from the response. There
   * is nothing optimistic here and no refetch of the trade on success.
   *
   * On a failure the board is re-read once, because the two things this screen
   * most needs to know are only answerable from the trade's own state: whether
   * it survived (a rolled-back accept is still PENDING and still declinable),
   * and whether it had in fact already finished. See `recoveryFor` and
   * `finishedTrade` for why that is a re-read rather than a match on the
   * server's wording.
   */
  const respond = useCallback(
    async (which: Answer) => {
      if (!trade || busy !== null) return;
      setBusy(which);
      try {
        const updated =
          which === "accept" ? await api.acceptTrade(trade.id) : await api.declineTrade(trade.id);
        setTrade(updated);
        setPhase({ kind: "outcome" });
      } catch (e) {
        const recheck = await recheckBoard(trade.id);

        // Already over — either somebody's answer landed first, or this one
        // landed and its response was lost. Both read as the outcome, taken
        // from the trade's real status rather than from what was attempted.
        const finished = finishedTrade(recheck);
        if (finished) {
          setTrade(finished);
          setPhase({ kind: "outcome" });
          return;
        }

        // Still pending. Keep the fresher copy: `fulfillable` may have flipped
        // since the screen loaded, and the recovery below may hand the viewer
        // straight back to it.
        if (recheck.ok && recheck.trade) setTrade(recheck.trade);

        setPhase({
          kind: "failed",
          answer: which,
          message: messageFor(e, copy.review.failed.body),
          recovery: recoveryFor(e, which, recheck),
        });
      } finally {
        setBusy(null);
      }
    },
    [trade, busy]
  );

  const back = (
    <Pressable
      style={styles.back}
      onPress={goBack}
      accessibilityRole="button"
      accessibilityLabel={copy.review.backToBoard}
      hitSlop={8}
    >
      <Ionicons name="chevron-back" size={26} color={colors.black} />
    </Pressable>
  );

  // ---- Entry: the trade is being looked up ----
  if (phase.kind === "loading") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {back}
        <View style={styles.centered}>
          <ActivityIndicator color={colors.black} />
          <Text style={styles.resultBody}>{copy.review.loading}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---- The board could not be read ----
  if (phase.kind === "loadFailed") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {back}
        <Result
          icon="cloud-offline-outline"
          title={copy.review.loadError.title}
          body={phase.message}
        >
          <PrimaryButton label={copy.review.loadError.retry} onPress={load} />
          <View style={styles.actionGap} />
          <PrimaryButton label={copy.review.backToBoard} variant="outline" onPress={goBack} />
        </Result>
      </SafeAreaView>
    );
  }

  // ---- The board came back without this trade on it ----
  // A stale board, or a link to a trade the viewer is not part of. `GET /trades`
  // filters by participant, so those two are indistinguishable from here and the
  // copy says only what is true of both.
  if (phase.kind === "notFound" || !trade) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {back}
        <Result
          icon="help-circle-outline"
          title={copy.review.notFound.title}
          body={copy.review.notFound.body}
        >
          <PrimaryButton label={copy.review.backToBoard} onPress={goBack} />
        </Result>
      </SafeAreaView>
    );
  }

  const { give, get } = giveAndGet(trade.direction, trade.offeredCard, trade.requestedCard);

  // ---- Answered: by this screen, or elsewhere ----
  if (phase.kind === "outcome") {
    // Only ACCEPTED and DECLINED reach here — a success flipped the status, and
    // the re-read path is gated on the trade no longer being PENDING.
    const accepted = trade.status === "ACCEPTED";
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {back}
        <Result
          icon={accepted ? "checkmark-circle" : "close-circle"}
          tint={accepted ? colors.gold : colors.grey}
          title={accepted ? copy.review.accepted : copy.review.declined}
          body={
            accepted
              ? fill(copy.review.acceptedBody, { give: nameOf(give), get: nameOf(get) })
              : copy.review.declinedBody
          }
        >
          <PrimaryButton label={copy.review.backToBoard} onPress={goBack} />
        </Result>
      </SafeAreaView>
    );
  }

  // ---- An answer was refused ----
  if (phase.kind === "failed") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {back}
        <Result icon="alert-circle-outline" title={copy.review.failed.title} body={phase.message}>
          {/* The trade is still pending and decline never re-checks ownership,
              so this button cannot fail the way the accept just did. It acts on
              the first press rather than routing back through the decline
              confirmation — the hint under it carries what that confirmation
              would have said. */}
          {phase.recovery === "decline" && (
            <>
              <PrimaryButton
                label={copy.review.failed.declineInstead}
                onPress={() => respond("decline")}
                loading={busy === "decline"}
                disabled={busy !== null}
              />
              <Text style={styles.hint}>{copy.review.failed.declineInsteadHint}</Text>
              <View style={styles.actionGap} />
              <PrimaryButton
                label={copy.review.backToBoard}
                variant="outline"
                onPress={goBack}
                disabled={busy !== null}
              />
            </>
          )}

          {phase.recovery === "retry" && (
            <>
              <PrimaryButton
                label={copy.review.failed.retry}
                onPress={() => respond(phase.answer)}
                loading={busy !== null}
                disabled={busy !== null}
              />
              <View style={styles.actionGap} />
              <PrimaryButton
                label={copy.review.backToBoard}
                variant="outline"
                onPress={goBack}
                disabled={busy !== null}
              />
            </>
          )}

          {/* Somebody already answered this trade. Retrying is guaranteed to be
              refused the same way, so nothing here offers it — the board is the
              only place left to go. */}
          {phase.recovery === "board" && (
            <PrimaryButton label={copy.review.backToBoard} onPress={goBack} />
          )}
        </Result>
      </SafeAreaView>
    );
  }

  // ---- Review, and its confirmations ----

  // The other party, and the preposition that is true of the viewer's side.
  const sent = trade.direction === "sent";
  const partner = partnerOf(trade);

  // Only the recipient can ever end a trade, and only while it is pending. Note
  // this is deliberately wider than `isActionable`: a trade the API says can no
  // longer complete is still declinable, and refusing to draw the decline
  // button would strand it on the board forever.
  const answerable = trade.direction === "received" && trade.status === "PENDING";

  // Accept, specifically. `isActionable` adds `fulfillable !== false` to the
  // pair above — the same rule the board uses to decide a row leads anywhere,
  // reused so the two surfaces cannot disagree about when accepting is possible.
  const canAccept = isActionable(trade);

  const unfulfillable = isUnfulfillable(trade);

  const ownership = ownershipOf(trade, cards);

  // Which side of an unfulfillable trade is broken is inferred from the
  // collection above, not read off the API — `fulfillable` is one boolean over
  // both ownership checks. `brokenSide` carries the reasoning; the third string
  // is the side-neutral wording for a join that has not answered.
  const side = unfulfillable ? brokenSide(ownership) : null;
  const unfulfillableLine =
    side === "you"
      ? copy.review.unfulfillableYou
      : side === "them"
        ? copy.review.unfulfillableThem
        : copy.review.unfulfillable;

  const giveNote =
    ownership && ownership.giveQuantity === 1 ? copy.review.ownership.lastCopy : null;
  const getNote =
    ownership && ownership.getQuantity >= 1
      ? fill(copy.review.ownership.alreadyOwn, { count: ownership.getQuantity })
      : null;

  const dateLabel = tradeDateLabel(trade);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {back}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{copy.review.title}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.from} numberOfLines={1}>
            {fill(sent ? copy.review.to : copy.review.from, { username: partner.username })}
          </Text>
          {dateLabel !== "" && <Text style={styles.date}>{dateLabel}</Text>}
        </View>

        <View style={styles.cards}>
          <TradeCards
            direction={trade.direction}
            offeredCard={trade.offeredCard}
            requestedCard={trade.requestedCard}
            size="detail"
          />

          {/* The ownership join, laid out under the pair it annotates. The
              gutter matches the swap glyph `TradeCards` draws between the two
              columns, so each line sits under its own card. Both are empty
              until the collection arrives, and the row simply has no height. */}
          <View style={styles.notes}>
            <View style={styles.noteColumn}>
              {giveNote && <Text style={styles.noteText}>{giveNote}</Text>}
            </View>
            <View style={styles.noteGutter} />
            <View style={styles.noteColumn}>
              {getNote && <Text style={styles.noteText}>{getNote}</Text>}
            </View>
          </View>
        </View>

        {unfulfillable && (
          <View style={styles.banner}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.grey} />
            <Text style={styles.bannerText}>{unfulfillableLine}</Text>
          </View>
        )}

        {!answerable ? (
          // Reachable by link, or by a board that has gone stale under the
          // viewer — the board itself only pushes trades that can be answered.
          // The status sentence is the board's, not a second copy of it: the
          // same row means opposite things to the two parties, and one set of
          // strings is what keeps the two surfaces saying the same thing.
          <View style={styles.actions}>
            <Text style={styles.status}>{statusLine(trade)}</Text>
            {sent && trade.status === "PENDING" && (
              <Text style={styles.hint}>{copy.board.sentInert}</Text>
            )}
            <View style={styles.actionGap} />
            <PrimaryButton label={copy.review.backToBoard} onPress={goBack} />
          </View>
        ) : phase.kind === "confirm" ? (
          <Confirm
            answer={phase.answer}
            give={nameOf(give)}
            get={nameOf(get)}
            busy={busy}
            onConfirm={() => respond(phase.answer)}
            onCancel={() => setPhase({ kind: "review" })}
          />
        ) : (
          <View style={styles.actions}>
            {/* Neither button sends anything: they open a confirmation, which
                is what makes a swap with no undo a two-step action. The lock is
                still written on both, so the rule that accept and decline are
                never both live holds wherever an action button is drawn. */}
            <PrimaryButton
              label={copy.review.accept}
              onPress={() => setPhase({ kind: "confirm", answer: "accept" })}
              disabled={!canAccept || busy !== null}
            />
            <View style={styles.actionGap} />
            <PrimaryButton
              label={copy.review.decline}
              variant="outline"
              onPress={() => setPhase({ kind: "confirm", answer: "decline" })}
              disabled={busy !== null}
            />
            <Text style={styles.hint}>{copy.review.onlyYouCanAnswer}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The confirmation for one answer, in place of the two buttons.
 *
 * Inline rather than an overlay: this app has no dialog, sheet or toast
 * primitive, and the cards being traded are the context the decision needs, so
 * they stay on screen above it. It is also where both actions are locked while
 * a request is in flight — from here only one of them can be sent at all.
 */
function Confirm({
  answer,
  give,
  get,
  busy,
  onConfirm,
  onCancel,
}: {
  answer: Answer;
  /** The name of the card the viewer would give away. */
  give: string;
  /** The name of the card the viewer would receive. */
  get: string;
  busy: Answer | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const accepting = answer === "accept";
  const strings = accepting ? copy.review.confirmAccept : copy.review.confirmDecline;

  return (
    <View style={styles.confirm}>
      <Text style={styles.confirmTitle}>{strings.title}</Text>
      <Text style={styles.confirmBody}>
        {accepting ? fill(strings.body, { give, get }) : strings.body}
      </Text>
      <PrimaryButton
        label={strings.confirm}
        onPress={onConfirm}
        loading={busy === answer}
        disabled={busy !== null}
      />
      <View style={styles.actionGap} />
      <PrimaryButton
        label={strings.cancel}
        variant="outline"
        onPress={onCancel}
        disabled={busy !== null}
      />
    </View>
  );
}

/**
 * A full-screen result: glyph, title, one line, and whatever can be done next.
 *
 * The shape `scan-camera.tsx` established for the end of a flow, in this
 * screen's light palette. Four states share it — loaded nothing, found nothing,
 * finished, and refused — because they differ only in what they offer, and four
 * layouts would be four places for the next one to drift.
 */
function Result({
  icon,
  tint = colors.grey,
  title,
  body,
  children,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  tint?: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.centered}>
      <Ionicons name={icon} size={56} color={tint} />
      <Text style={styles.resultTitle}>{title}</Text>
      <Text style={styles.resultBody}>{body}</Text>
      <View style={styles.resultActions}>{children}</View>
    </View>
  );
}

/**
 * Mirrors the swap glyph `TradeCards` draws at `size="detail"` — a 26pt icon
 * with 10pt of margin on each side — so the annotation columns line up with the
 * cards above them.
 */
const CARD_GUTTER = 46;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  back: { padding: 12 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },

  title: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: colors.black,
    textTransform: "lowercase",
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  from: { fontFamily: fonts.regular, fontSize: 15, color: colors.grey, flex: 1 },
  date: { fontFamily: fonts.regular, fontSize: 13, color: colors.grey },

  cards: { marginTop: 24 },
  notes: { flexDirection: "row", marginTop: 8 },
  noteColumn: { flex: 1 },
  noteGutter: { width: CARD_GUTTER },
  noteText: { fontFamily: fonts.regular, fontSize: 12, color: colors.grey, lineHeight: 17 },

  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.lightGrey,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 20,
  },
  bannerText: { fontFamily: fonts.regular, fontSize: 13, color: colors.grey, flex: 1 },

  actions: { marginTop: 28 },
  actionGap: { height: 12 },
  status: { fontFamily: fonts.bold, fontSize: 15, color: colors.black },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.grey,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 14,
  },

  confirm: {
    marginTop: 28,
    borderWidth: 1.5,
    borderColor: colors.black,
    borderRadius: radius.md,
    padding: 18,
  },
  confirmTitle: { fontFamily: fonts.bold, fontSize: 19, color: colors.black },
  confirmBody: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.grey,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 20,
  },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  resultTitle: { fontFamily: fonts.bold, fontSize: 22, color: colors.black, marginTop: 16 },
  resultBody: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.grey,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
  },
  resultActions: { alignSelf: "stretch", marginTop: 30 },
});
