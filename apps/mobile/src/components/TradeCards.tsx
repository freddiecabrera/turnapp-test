import { Image, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { rarityColor } from "./CardTile";
import { copy } from "../copy";
import { CARD_ASPECT, colors, fonts, radius } from "../theme";
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

  // As wide as the surface allows, up to the ceiling for this size. A 390pt
  // phone reaches the ceiling with a little to spare; a 360pt one lands just
  // under it and draws a slightly smaller card rather than one running off the
  // edge, which a hardcoded 140 would do.
  const { width: windowWidth } = useWindowDimensions();
  const available = (windowWidth - SURFACE_CHROME[size]) / 2;
  const cardWidth = Math.max(MIN_CARD_WIDTH, Math.min(MAX_CARD_WIDTH[size], available));

  return (
    <View style={styles.wrap}>
      <TradeCard
        card={give}
        label={copy.trade.give}
        detail={detail}
        width={cardWidth}
        testID={GIVE_TEST_ID}
      />
      <Ionicons
        name="swap-horizontal"
        size={detail ? 26 : 18}
        color={colors.grey}
        style={styles.arrow}
      />
      <TradeCard
        card={get}
        label={copy.trade.get}
        detail={detail}
        width={cardWidth}
        testID={GET_TEST_ID}
      />
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
  width,
  testID,
}: {
  card: Card;
  label: string;
  detail: boolean;
  /** Measured by the parent, so both columns are identical by construction. */
  width: number;
  testID: string;
}) {
  return (
    <View style={styles.side} testID={testID}>
      <Text style={[styles.label, detail && styles.labelDetail]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.art, detail && styles.artDetail, { width }]}>
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
 * The widest a card is drawn on each surface. `aspectRatio` derives the height,
 * so 140 draws a 292pt card and 150 draws a 313pt one.
 *
 * A card at its true shape is narrow, and the pair sat in a row with something
 * like ninety points of unused gutter on either side of it — the cards read as
 * slim not because the artwork is, but because the layout was capped to keep
 * rows short. These take that space back. The board pays for it in row height
 * (roughly 1.5 trades per screen instead of 2.5, which is the deliberate trade)
 * and the review screen pays nothing at all: it is a scroll view whose actions
 * were already sitting above a screenful of white space.
 */
const MAX_CARD_WIDTH = { row: 140, detail: 150 } as const;

/**
 * The horizontal space *outside* the two cards, per surface: the padding of
 * everything wrapping the pair, plus the gutter the swap glyph sits in.
 *
 * `row` — the board list's 16 either side, `TradeRow`'s card padding of 14
 * either side, and this component's 18pt glyph in its 10pt margins.
 * `detail` — the review screen's `content` padding of 20 either side, and the
 * larger 26pt glyph in the same margins. That second figure is the one
 * `app/trade/[id].tsx` already hardcodes as `CARD_GUTTER` so its ownership
 * notes line up under the columns.
 *
 * Knowing this much about its callers is not lovely, and the alternative is
 * worse: `width: "100%"` with a `maxWidth` cap reads as the responsive version
 * and silently isn't. `aspectRatio` resolves against the percentage width — the
 * full column — and `maxWidth` then clamps only the width, leaving a box tall
 * enough for a card twice as wide, with the surplus drawn as grey bars above
 * and below the card. Measuring the space and picking a number is the version
 * that actually works.
 */
const SURFACE_CHROME = { row: 98, detail: 86 } as const;

/** Below this a card is too small to read, and letterboxing is the better bug. */
const MIN_CARD_WIDTH = 72;

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
  // `width` is applied inline, measured against the window.
  art: {
    aspectRatio: CARD_ASPECT,
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
    alignSelf: "stretch",
    textAlign: "center",
  },
  nameDetail: { fontFamily: fonts.bold, fontSize: 16, marginTop: 10 },
});
