import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TradeCards } from "./TradeCards";
import { copy } from "../copy";
import { colors, fonts, radius } from "../theme";
import {
  isActionable,
  isAnswerable,
  isUnfulfillable,
  partnerOf,
  statusLine,
  tradeDateLabel,
} from "../trade";
import type { Trade } from "../types";

/**
 * Re-exported from `../trade`, which is where these moved once the review
 * screen needed the same answers this row does. The suites reach for them here,
 * and a symbol changing files is no reason for its importers to change lines.
 */
export { STATUS_KEY, isActionable, isAnswerable } from "../trade";

export function TradeRow({ trade, onPress }: { trade: Trade; onPress?: () => void }) {
  // Two different questions, and collapsing them into one is what stranded a
  // trade forever. `answerable` decides whether the row opens; `actionable`
  // decides whether it is emphasised as something that can be accepted. An
  // incoming PENDING offer that can no longer complete is the row where they
  // disagree: it is not urgent, but declining it is the only way it ever leaves
  // either board, and the review screen behind it is the only place to do that.
  const answerable = isAnswerable(trade);
  const actionable = isActionable(trade);
  const unfulfillable = isUnfulfillable(trade);
  const partner = partnerOf(trade);

  const dateLabel = tradeDateLabel(trade);

  const body = (
    <>
      <View style={styles.head}>
        <View style={styles.identity}>
          <Text style={styles.partner} numberOfLines={1}>
            @{partner.username}
          </Text>
          {dateLabel !== "" && <Text style={styles.date}>{dateLabel}</Text>}
        </View>

        {/* Where a trade stands, at the top of the card rather than under it.
            Status is the most scannable thing about a row — it is what someone
            runs their eye down a board for — and it was the last thing on the
            card, below two pieces of art. Only an actionable row gets the
            filled chip: solid black is the screen's strongest emphasis and
            spending it anywhere else is what made three different controls
            read as equally urgent. */}
        <View style={[styles.chip, actionable && styles.chipActionable]}>
          <Text style={[styles.chipText, actionable && styles.chipTextActionable]}>
            {statusLine(trade)}
          </Text>
        </View>

        {/* The chevron follows the press, not the emphasis: it is the promise
            that a row leads somewhere, and every row that opens keeps it. On an
            unfulfillable row that promise is still true — what is behind it is
            the decline. */}
        {answerable && (
          <Ionicons name="chevron-forward" size={18} color={colors.black} style={styles.chevron} />
        )}
      </View>

      <View style={unfulfillable ? styles.dimmed : undefined}>
        <TradeCards
          direction={trade.direction}
          offeredCard={trade.offeredCard}
          requestedCard={trade.requestedCard}
        />
      </View>

      {unfulfillable && (
        <View style={styles.note}>
          <Ionicons name="alert-circle-outline" size={14} color={colors.grey} />
          <Text style={styles.noteText}>{copy.board.unfulfillable}</Text>
        </View>
      )}
    </>
  );

  // Inert rows are a plain View, not a disabled Pressable: there is nothing to
  // press, and a pressable that swallows touches is the dead affordance this is
  // meant to avoid. An unfulfillable incoming offer is not one of them — it
  // opens, and only the strong border is withheld.
  if (!answerable) return <View style={styles.card}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.card,
        actionable && styles.actionable,
        pressed && styles.pressed,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderColor: colors.lightGrey,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 12,
    backgroundColor: colors.white,
  },
  // The only rows that lead anywhere carry the full-strength border.
  actionable: { borderColor: colors.black },
  pressed: { opacity: 0.85 },
  head: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 },
  // Username over date, so the chip beside them gets the full height of the
  // row to sit against and a long username has somewhere to go but the ellipsis.
  identity: { flex: 1 },
  partner: { fontFamily: fonts.bold, fontSize: 15, color: colors.black },
  date: { fontFamily: fonts.regular, fontSize: 12, color: colors.grey, marginTop: 2 },
  chevron: { marginLeft: -2 },
  dimmed: { opacity: 0.45 },

  chip: {
    backgroundColor: colors.lightGrey,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipActionable: { backgroundColor: colors.black },
  chipText: { fontFamily: fonts.bold, fontSize: 11, color: colors.black },
  chipTextActionable: { color: colors.white },

  note: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  noteText: { fontFamily: fonts.regular, fontSize: 12, color: colors.grey, flex: 1 },
});
