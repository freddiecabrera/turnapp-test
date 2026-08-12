import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TradeCards } from "./TradeCards";
import { copy } from "../copy";
import { colors, fonts, radius } from "../theme";
import {
  isActionable,
  isUnfulfillable,
  partnerOf,
  statusLine,
  tradeDateLabel,
} from "../trade";
import type { Trade } from "../types";

/**
 * Re-exported from `../trade`, which is where these two moved once the review
 * screen needed the same answers this row does. The suites reach for them here,
 * and a symbol changing files is no reason for its importers to change lines.
 */
export { STATUS_KEY, isActionable } from "../trade";

export function TradeRow({ trade, onPress }: { trade: Trade; onPress?: () => void }) {
  const actionable = isActionable(trade);
  const unfulfillable = isUnfulfillable(trade);
  const partner = partnerOf(trade);

  // An outgoing offer still waiting on an answer is the one place someone will
  // hunt for a cancel button, so that is where the inert note belongs. On an
  // answered outgoing row the status line already says there is nothing to do.
  const showInertNote = trade.direction === "sent" && trade.status === "PENDING";

  const dateLabel = tradeDateLabel(trade);

  const body = (
    <>
      <View style={styles.head}>
        <Text style={styles.partner} numberOfLines={1}>
          @{partner.username}
        </Text>
        {dateLabel !== "" && <Text style={styles.date}>{dateLabel}</Text>}
        {actionable && (
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

      <Text style={styles.status}>{statusLine(trade)}</Text>

      {unfulfillable && (
        <View style={styles.note}>
          <Ionicons name="alert-circle-outline" size={14} color={colors.grey} />
          <Text style={styles.noteText}>{copy.board.unfulfillable}</Text>
        </View>
      )}

      {showInertNote && (
        <View style={styles.note}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.grey} />
          <Text style={styles.noteText}>{copy.board.sentInert}</Text>
        </View>
      )}
    </>
  );

  // Inert rows are a plain View, not a disabled Pressable: there is nothing to
  // press, and a pressable that swallows touches is the dead affordance this is
  // meant to avoid.
  if (!actionable) return <View style={styles.card}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, styles.actionable, pressed && styles.pressed]}
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
  head: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  partner: { fontFamily: fonts.bold, fontSize: 15, color: colors.black, flex: 1 },
  date: { fontFamily: fonts.regular, fontSize: 12, color: colors.grey },
  chevron: { marginLeft: 6 },
  dimmed: { opacity: 0.45 },
  status: { fontFamily: fonts.bold, fontSize: 13, color: colors.black, marginTop: 12 },
  note: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  noteText: { fontFamily: fonts.regular, fontSize: 12, color: colors.grey, flex: 1 },
});
