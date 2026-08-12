import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TradeCards } from "./TradeCards";
import { copy } from "../copy";
import { colors, fonts, radius } from "../theme";
import type { Trade, TradeStatus } from "../types";

/** `TradeStatus` is SCREAMING_CASE on the wire; `copy.board.status` is keyed lowercase. */
const STATUS_KEY = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  DECLINED: "declined",
} as const satisfies Record<TradeStatus, string>;

/**
 * Whether this row does anything when pressed.
 *
 * Exactly one of the eight direction/status/fulfillable combinations is
 * actionable: a PENDING trade sent *to* the viewer that can still complete.
 *
 * Two rules are load-bearing here.
 *
 * **A sent trade has no action, ever.** There is no cancel or withdraw
 * endpoint, and the sender cannot decline their own offer — `POST
 * /trades/:id/decline` 403s anyone but the recipient, deliberately, because
 * reporting a withdrawal as the other person's refusal would corrupt the one
 * column whose job is to record what a human did. So an outgoing row is inert
 * in every status.
 *
 * **`fulfillable === false` is not actionable**, and the test is against
 * `false` rather than falsiness. The field is `boolean | null`, and `null`
 * means "not applicable / not computed" — the serializer forces it for every
 * answered trade. Treating `null` as `false` would paint finished trades as
 * broken ones. A `null` on a live PENDING row is not something `GET /trades`
 * produces, but if it ever appeared, leaving the row actionable is the safe
 * side: accept re-verifies ownership atomically and refuses on its own terms.
 */
export function isActionable(trade: Trade): boolean {
  return (
    trade.direction === "received" && trade.status === "PENDING" && trade.fulfillable !== false
  );
}

export function TradeRow({ trade, onPress }: { trade: Trade; onPress?: () => void }) {
  const actionable = isActionable(trade);

  // Strictly `false`. See `isActionable` — `null` is "not applicable", and
  // drawing the can't-complete treatment on it would mark every answered trade
  // as failed.
  const unfulfillable = trade.fulfillable === false;

  // The other person, whichever side of the row the viewer is on.
  const partner = trade.direction === "sent" ? trade.toUser : trade.fromUser;

  // An outgoing offer still waiting on an answer is the one place someone will
  // hunt for a cancel button, so that is where the inert note belongs. On an
  // answered outgoing row the status line already says there is nothing to do.
  const showInertNote = trade.direction === "sent" && trade.status === "PENDING";

  // `createdAt`, not `respondedAt`. The board is ordered by creation, so a
  // month-old trade answered today sits a month down the list — showing the
  // creation date is what makes that ordering legible rather than broken.
  const created = new Date(trade.createdAt);
  const dateLabel = Number.isNaN(created.getTime()) ? "" : created.toLocaleDateString();

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

      <Text style={styles.status}>
        {copy.board.status[trade.direction][STATUS_KEY[trade.status]]}
      </Text>

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
