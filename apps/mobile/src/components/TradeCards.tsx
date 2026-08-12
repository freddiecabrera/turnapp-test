import { Image, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { rarityColor } from "./CardTile";
import { copy } from "../copy";
import { colors, fonts, radius } from "../theme";
import { giveAndGet, type TradeDirection } from "../trade";
import type { Card } from "../types";

/**
 * Re-exported from `../trade`, where the inversion lives now that a module with
 * no React in it needs it too. Both names read as this component's from every
 * surface that draws a trade, and moving the definition is no reason to make
 * its importers move with it.
 */
export { giveAndGet, type TradeDirection } from "../trade";

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
          // `contain`, not `cover`. The box is already the shape of a card, so
          // the two agree for every image the seed ships — but admins upload
          // card art, and `cover` answers a differently-proportioned upload by
          // cropping it. `contain` letterboxes it against the grey instead,
          // which shows a wrong-shaped card as wrong-shaped rather than as
          // correct-and-missing-its-story.
          <Image source={{ uri: card.imageUrl }} style={styles.image} resizeMode="contain" />
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

/**
 * The proportions of a turn card: 575 × 1198, which is what every image in
 * `apps/api/static/cards` is exported at.
 *
 * The box used to be `0.7` — the proportions of a physical trading card, and a
 * reasonable guess at these. It is not what these are. A turn card is much
 * taller: header bar, art, name, rarity pips, universe, type badge and the
 * card's story, stacked. Held in a 0.7 box by `cover`, the whole bottom third
 * was cropped away, so every trade drew two cards cut off mid-sentence.
 */
const CARD_ASPECT = 575 / 1198;

/**
 * How wide a card is drawn on each surface. `aspectRatio` derives the height.
 *
 * A fixed width rather than `width: "100%"` with a `maxWidth` cap. That pairing
 * looks more responsive and is wrong: `aspectRatio` resolves against the
 * percentage width — the full column — and `maxWidth` then clamps only the
 * width, leaving a box the height of a card twice as wide. The card sits
 * correctly inside it and the extra a hundred points draw as grey bars above
 * and below, which is the same "the card looks broken" this whole change set
 * out to fix.
 *
 * Both numbers are chosen so each surface keeps the height it already had. A
 * card at its true shape is much narrower than the 0.7 box it replaces, and
 * these widths land within a couple of points of the old heights, so nothing
 * below moves: the board's rows are the size they were, and the review screen's
 * accept and decline buttons stay where they were on screen. They are also
 * comfortably narrower than the tightest column any supported phone gives a
 * card, so neither needs to shrink to fit.
 */
const ROW_CARD_WIDTH = 100;
const DETAIL_CARD_WIDTH = 108;

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center" },
  // Centred, because a card no longer fills its column: left-aligning the
  // label and name against the column edge would leave them floating away
  // from the card they belong to.
  side: { flex: 1, alignItems: "center" },
  arrow: { marginHorizontal: 10 },
  label: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.grey,
    textTransform: "lowercase",
    marginBottom: 5,
    alignSelf: "stretch",
    textAlign: "center",
  },
  labelDetail: { fontSize: 13, marginBottom: 8 },
  art: {
    width: ROW_CARD_WIDTH,
    aspectRatio: CARD_ASPECT,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.lightGrey,
  },
  artDetail: { width: DETAIL_CARD_WIDTH, borderRadius: radius.md },
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
    alignSelf: "stretch",
    textAlign: "center",
  },
  nameDetail: { fontFamily: fonts.bold, fontSize: 16, marginTop: 10 },
});
