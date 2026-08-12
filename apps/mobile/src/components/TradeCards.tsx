import { Image, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { rarityColor } from "./CardTile";
import { copy } from "../copy";
import { colors, fonts, radius } from "../theme";
import type { Card } from "../types";

/**
 * The two cards in a trade, labelled from the viewer's side.
 *
 * **Why this is not `CardTile`.** `CardTile` takes a `CardWithOwnership` and
 * draws a locked card-back whenever `owned` is false. A trade's cards are plain
 * `Card`s with no ownership on them, and half of them are by definition cards
 * the viewer does *not* own — that is the entire point of a trade. Passing a
 * fabricated `owned: true` through `CardTile` would work by accident and lie in
 * the type. So: a separate presentation that draws real art unconditionally.
 *
 * **Why `direction` is a required prop.** The stored columns are
 * sender-relative — `offeredCard` always belongs to `fromUser` — so one row
 * means opposite things to the two parties (DESIGN.md, "Column names are
 * sender-relative"). Handing this component the raw columns without the
 * viewer's side would make a correct label impossible. No label here ever reads
 * "requested card": that word is wrong for half the users, and the give/get
 * pair in `copy.ts` is right for both.
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

export function TradeCards({
  direction,
  offeredCard,
  requestedCard,
  size = "row",
}: {
  direction: TradeDirection;
  /** The trade's `offeredCard` column, exactly as the API sent it. */
  offeredCard: Card;
  /** The trade's `requestedCard` column, exactly as the API sent it. */
  requestedCard: Card;
  /** `row` for a board row, `detail` for a full screen. Defaults to `row`. */
  size?: "row" | "detail";
}) {
  const { give, get } = giveAndGet(direction, offeredCard, requestedCard);
  const detail = size === "detail";

  return (
    <View style={styles.wrap}>
      <TradeCard card={give} label={copy.trade.give} detail={detail} testID={GIVE_TEST_ID} />
      <Ionicons
        name="swap-horizontal"
        size={detail ? 26 : 18}
        color={colors.grey}
        style={styles.arrow}
      />
      <TradeCard card={get} label={copy.trade.get} detail={detail} testID={GET_TEST_ID} />
    </View>
  );
}

/**
 * Handles on the two columns, so the inversion above can be asserted.
 *
 * Which card lands on which side is the single most invertible fact in the
 * feature and the one all three trading surfaces inherit from here — but the
 * only thing separating the two columns on screen is their `copy.ts` label, and
 * those strings are provisional and owned by the repo owner. A test that reached
 * for the give column by its wording would fail the day that wording changed and
 * would report it as the trade rendering backwards.
 *
 * Exported rather than written as a literal in a suite for the same reason the
 * component is the only place `giveAndGet` is called: one name, or two that
 * drift.
 */
export const GIVE_TEST_ID = "trade-card-give";
export const GET_TEST_ID = "trade-card-get";

function TradeCard({
  card,
  label,
  detail,
  testID,
}: {
  card: Card;
  label: string;
  detail: boolean;
  testID: string;
}) {
  return (
    <View style={styles.side} testID={testID}>
      <Text style={[styles.label, detail && styles.labelDetail]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.art, detail && styles.artDetail]}>
        {card.imageUrl ? (
          <Image source={{ uri: card.imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          // Not the locked card-back: that glyph means "you don't own this",
          // which is a different fact from "the API sent no image".
          <View style={styles.noArt}>
            <Ionicons name="image-outline" size={detail ? 28 : 18} color={colors.grey} />
          </View>
        )}
      </View>
      <View style={[styles.accent, { backgroundColor: rarityColor(card.rarity) }]} />
      <Text style={[styles.name, detail && styles.nameDetail]} numberOfLines={detail ? 2 : 1}>
        {card.name || copy.trade.unnamedCard}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center" },
  side: { flex: 1 },
  arrow: { marginHorizontal: 10 },
  label: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.grey,
    textTransform: "lowercase",
    marginBottom: 5,
  },
  labelDetail: { fontSize: 13, marginBottom: 8 },
  art: {
    aspectRatio: 0.7,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.lightGrey,
  },
  artDetail: { borderRadius: radius.md },
  image: { width: "100%", height: "100%" },
  noArt: { flex: 1, alignItems: "center", justifyContent: "center" },
  accent: {
    height: 3,
    borderRadius: 2,
    marginTop: 6,
    width: "70%",
    alignSelf: "center",
  },
  name: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.black,
    marginTop: 6,
  },
  nameDetail: { fontFamily: fonts.bold, fontSize: 16, marginTop: 10 },
});
