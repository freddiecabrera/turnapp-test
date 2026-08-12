import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { PrimaryButton } from "./PrimaryButton";
import { TradeRow } from "./TradeRow";
import { api, messageFor } from "../api";
import { copy, fill } from "../copy";
import { colors, fonts, radius } from "../theme";
import { BOARD_SECTIONS, sectionOf, type BoardSection } from "../trade";
import type { Trade } from "../types";

/**
 * TH-10 — the trading board.
 *
 * Lives behind the existing `trading board` pill on the collectibles screen
 * rather than in a tab or route of its own, so this is a panel and not a
 * screen: `app/(tabs)/cards.tsx` renders it where the `coming soon` placeholder
 * used to be.
 *
 * Backed solely by `GET /trades`, which takes no parameters and returns every
 * trade the viewer has ever been in — both directions, every status, ordered
 * `createdAt DESC, id DESC`. So the grouping below is client-side and there is
 * no pagination. Within a section the API's ordering is preserved untouched: an
 * old trade answered today stays where its creation date puts it, which is
 * deliberate and not an oversight.
 *
 * **Why sections rather than filter pills.** This panel used to stack an
 * all/incoming/outgoing pill row, a black pending-count badge and an outlined
 * "start a trade" pill above the list — three rows of chrome under the
 * collectibles pills, four controls, three of them wearing the same shape, and
 * roughly half the screen gone before the first trade. Two of those rows are
 * now one thing: the list groups by what the viewer can do about a trade, and
 * each group's header carries its own count. That answers the question people
 * actually open this screen with — what needs me? — which the direction filter
 * could not ask, because "incoming" mixed the one unanswered offer in with
 * every incoming trade already settled.
 */

export function TradingBoard() {
  const router = useRouter();

  // `null` means "nothing has ever loaded", which is what separates the
  // load-failed-with-nothing-cached state from a refresh that failed over rows
  // already on screen. An empty array is a successful load of no trades.
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Focus and pull-to-refresh can both be in flight at once, and without this
  // the slower response wins regardless of which was asked for last — an older
  // board quietly overwriting a newer one. Only the most recent run may write.
  const runId = useRef(0);

  const load = useCallback(async () => {
    const id = ++runId.current;
    try {
      const next = await api.trades();
      if (id !== runId.current) return;
      setTrades(next);
      setError(null);
    } catch (e) {
      if (id !== runId.current) return;
      setError(messageFor(e, copy.board.error.body));
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }, []);

  // Same pattern as the other tabs: refresh on focus, without remounting.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Retrying from the error state has no rows to sit behind and no
  // `RefreshControl` spinner of its own, so it puts the panel back into its
  // first-load state. Without this the button looks dead for the whole request.
  const retry = useCallback(() => {
    setLoading(true);
    load();
  }, [load]);

  const startTrade = useCallback(() => router.push("/trade/new"), [router]);

  /**
   * The board, grouped and counted.
   *
   * Built by walking the list once in the order the API sent it, so each
   * section inherits `createdAt DESC` for free. An empty section is dropped
   * rather than drawn with a zero — a header reading "needs you · 0" is a row
   * of chrome saying nothing, which is the thing this layout set out to remove.
   */
  const sections = useMemo(() => {
    const grouped: Record<BoardSection, Trade[]> = { needsYou: [], waiting: [], history: [] };
    for (const trade of trades ?? []) grouped[sectionOf(trade)].push(trade);

    return BOARD_SECTIONS.filter((key) => grouped[key].length > 0).map((key) => ({
      key,
      title: fill(copy.board.sections[key], { count: grouped[key].length }),
      data: grouped[key],
    }));
  }, [trades]);

  /**
   * The way into a new trade, from a board that already has trades on it.
   *
   * Floating rather than in the flow: this is the one control on the panel that
   * creates something, it is the same action in every state, and as a row above
   * the list it both scrolled away and sat visually below the two filled black
   * pills that outranked it. A round filled button over the list gives it one
   * permanent home, within thumb reach, competing with nothing.
   *
   * The empty state keeps its full-width button instead — there is no list for
   * this to float over, and an empty board's whole job is to offer the way in.
   */
  const fab = (
    <Pressable
      onPress={startTrade}
      accessibilityRole="button"
      accessibilityLabel={copy.board.startTrade}
      style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
    >
      <Ionicons name="add" size={30} color={colors.white} />
    </Pressable>
  );

  // ---- First load: nothing to show yet ----
  if (loading && trades === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.black} />
      </View>
    );
  }

  // ---- Load failed with nothing cached ----
  // Distinct from a failed refresh: there are no rows to fall back to, so the
  // whole panel is the error — and the way into a new trade still has to work.
  if (trades === null) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.grey} />
        <Text style={styles.emptyTitle}>{copy.board.error.title}</Text>
        <Text style={styles.emptyBody}>{error ?? copy.board.error.body}</Text>
        <View style={styles.emptyActions}>
          <PrimaryButton label={copy.board.error.retry} onPress={retry} />
          <View style={styles.actionGap} />
          <PrimaryButton label={copy.board.error.action} variant="outline" onPress={startTrade} />
        </View>
      </View>
    );
  }

  // ---- Never traded at all ----
  // The way in is the whole point of the state, so it is a full-width button
  // and not the floating one.
  if (trades.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="swap-horizontal" size={40} color={colors.grey} />
        <Text style={styles.emptyTitle}>{copy.board.emptyNever.title}</Text>
        <Text style={styles.emptyBody}>{copy.board.emptyNever.body}</Text>
        <View style={styles.emptyActions}>
          <PrimaryButton label={copy.board.emptyNever.action} onPress={startTrade} />
        </View>
      </View>
    );
  }

  // ---- Populated ----
  return (
    <View style={styles.wrap}>
      <SectionList
        sections={sections}
        keyExtractor={(trade) => trade.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          // A refresh failed but earlier rows are still on screen. The rows
          // stay; the banner says they are stale.
          error !== null ? (
            <View style={styles.staleBanner}>
              <Ionicons name="alert-circle-outline" size={15} color={colors.grey} />
              <Text style={styles.staleText}>{copy.board.refreshFailed}</Text>
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <TradeRow trade={item} onPress={() => router.push(`/trade/${item.id}`)} />
        )}
      />
      {fab}
    </View>
  );
}

const FAB_SIZE = 56;

const styles = StyleSheet.create({
  wrap: { flex: 1 },

  list: {
    paddingHorizontal: 16,
    // Clears the floating button, so the last row can always be read and
    // pressed rather than sitting under it.
    paddingBottom: FAB_SIZE + 40,
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },

  // Opaque, because the header sticks: a translucent one would drag the rows
  // scrolling underneath it along behind the words.
  sectionHeader: { backgroundColor: colors.white, paddingTop: 4, paddingBottom: 10 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 13, color: colors.grey },

  emptyTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.black, marginTop: 14 },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.grey,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
  },
  emptyActions: { alignSelf: "stretch", marginTop: 26 },
  actionGap: { height: 12 },

  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.lightGrey,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  staleText: { fontFamily: fonts.regular, fontSize: 13, color: colors.grey, flex: 1 },

  fab: {
    position: "absolute",
    right: 16,
    bottom: 20,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: colors.black,
    alignItems: "center",
    justifyContent: "center",
    // Lifts it off the rows it floats over, on both platforms.
    shadowColor: colors.black,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: { opacity: 0.85 },
});
