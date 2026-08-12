import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { rarityColor } from "./CardTile";
import { colors, fonts, radius } from "../theme";
import type { Card } from "../types";

/**
 * The two pieces the wizard's card grids are built from.
 *
 * Steps 2 and 3 are the same interaction — a three-column grid, tap to select,
 * one selection at a time — over two different collections, and the difference
 * between those collections is exactly one fact: step 2 shows cards the viewer
 * owns, step 3 shows cards somebody else owns.
 *
 * So the *ring* is shared and the *tile* is not. `SelectableCell` wraps
 * whichever tile a step uses, which lets step 2 keep the real `CardTile` from
 * the collectibles grid — same art, same duplicate badge, and honestly typed,
 * because those cards genuinely are `CardWithOwnership` with `owned: true`.
 * `PartnerCardTile` exists for the other half, and for the reason `TradeCards`
 * already documents: `CardTile` draws a locked card-back whenever `owned` is
 * false, and every card in step 3 is by definition one the viewer does not own.
 * Passing a fabricated `owned: true` through it would work by accident and put
 * a false claim in the type.
 */

/**
 * The selection ring, drawn around whatever tile a step renders.
 *
 * The border is always present and only changes colour, so selecting a card
 * cannot reflow the grid — a ring that appears on tap would shift every tile
 * below it by two pixels, which reads as the list twitching.
 */
export function SelectableCell({
  selected,
  children,
}: {
  selected: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[styles.cell, selected && styles.cellSelected]}>
      {children}
      {selected && (
        <View style={styles.check}>
          <Ionicons name="checkmark" size={13} color={colors.white} />
        </View>
      )}
    </View>
  );
}

/**
 * One card from somebody else's collection.
 *
 * Draws real art unconditionally — see the note above on why this is not
 * `CardTile`. The geometry is deliberately `CardTile`'s, because the two sit on
 * consecutive steps of one flow and a different aspect ratio or corner radius
 * between them would read as two different grids.
 *
 * `quantity` is the partner's count, badged past one exactly as the
 * collectibles grid badges the viewer's own duplicates. `marker` is the
 * optional "you own one of these too" label, and it is `string | null` rather
 * than optional because `exactOptionalPropertyTypes` is on and the caller
 * computes it conditionally.
 */
export function PartnerCardTile({
  card,
  quantity,
  marker,
  onPress,
}: {
  card: Card;
  quantity: number;
  marker: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.tile} onPress={onPress} accessibilityRole="button">
      <View style={styles.imageBox}>
        {card.imageUrl ? (
          <Image source={{ uri: card.imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          // Not the locked card-back: that glyph means "you don't own this",
          // which is true of every card on this screen and is not the fact
          // being reported here. The API sent no image; say only that.
          <View style={styles.noArt}>
            <Ionicons name="image-outline" size={20} color={colors.grey} />
          </View>
        )}

        {quantity > 1 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{quantity}</Text>
          </View>
        )}

        {marker !== null && (
          <View style={styles.marker}>
            <Text style={styles.markerText} numberOfLines={1}>
              {marker}
            </Text>
          </View>
        )}
      </View>
      <View style={[styles.accent, { backgroundColor: rarityColor(card.rarity) }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: radius.md,
    padding: 3,
  },
  cellSelected: { borderColor: colors.black },
  check: {
    position: "absolute",
    top: 9,
    left: 9,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.black,
    alignItems: "center",
    justifyContent: "center",
  },

  tile: { flex: 1 },
  imageBox: {
    aspectRatio: 0.7,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.lightGrey,
  },
  image: { width: "100%", height: "100%" },
  noArt: { flex: 1, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: 6,
    right: 6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.white, fontFamily: fonts.bold, fontSize: 12 },
  // An annotation, not a restriction. As a full-width band across the lower
  // third of the art this borrowed the locked card-back's language — the thing
  // that elsewhere means a card you cannot have — to say the opposite: that you
  // already have this one. On a partner whose every card the viewer owned, the
  // whole grid banded and the screen read as disabled. A chip in one corner
  // annotates the art instead of covering it, and leaves the card recognisable.
  //
  // Solid `black` behind a `white` hairline, rather than a translucent wash:
  // this season's art runs from pale pink to deep blue, and a wash legible over
  // one end disappears into the other. Here the fill always carries the white
  // text and the hairline always separates the chip from dark art, so neither
  // job depends on what happens to be underneath.
  marker: {
    position: "absolute",
    left: 6,
    bottom: 6,
    // With `numberOfLines={1}` on the label, this is what stops a longer marker
    // from growing back into the band being removed here.
    maxWidth: "85%",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.white,
    backgroundColor: colors.black,
  },
  markerText: {
    color: colors.white,
    fontFamily: fonts.bold,
    fontSize: 10,
  },
  accent: {
    height: 3,
    borderRadius: 2,
    marginTop: 6,
    width: "70%",
    alignSelf: "center",
  },
});
