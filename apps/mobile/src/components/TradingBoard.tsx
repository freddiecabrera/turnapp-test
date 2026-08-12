import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { PrimaryButton } from "./PrimaryButton";
import { TradeRow } from "./TradeRow";
import { ApiError, api } from "../api";
import { copy, fill } from "../copy";
import { colors, fonts, radius } from "../theme";
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
 * `createdAt DESC, id DESC`. So the filter below is client-side, there is no
 * pagination, and the list is deliberately *not* re-sorted: an old trade
 * answered today stays where its creation date puts it, which is the API's
 * ordering and not an oversight.
 */

const FILTERS = ["all", "incoming", "outgoing"] as const;
type Filter = (typeof FILTERS)[number];

/** `incoming`/`outgoing` are the viewer's words for the API's `received`/`sent`. */
const FILTER_DIRECTION = { incoming: "received", outgoing: "sent" } as const;

/**
 * The string to show for a failed load.
 *
 * An `ApiError` carries a sentence the server wrote for a human — `GET /trades`
 * can answer 401 or a fixed-sentence 500 — and those are rendered verbatim
 * rather than wrapped or remapped. Anything else is a rejected fetch whose
 * message is a diagnostic ("Network request failed", a URL, a native stack) and
 * must never reach the screen, so it becomes copy instead.
 */
function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : copy.board.error.body;
}

export function TradingBoard() {
  const router = useRouter();

  // `null` means "nothing has ever loaded", which is what separates the
  // load-failed-with-nothing-cached state from a refresh that failed over rows
  // already on screen. An empty array is a successful load of no trades.
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

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
      setError(messageFor(e));
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

  const visible = useMemo(() => {
    if (!trades || filter === "all") return trades ?? [];
    return trades.filter((t) => t.direction === FILTER_DIRECTION[filter]);
  }, [trades, filter]);

  // A pending count, not an unread one. The API has no seen/read field, so this
  // stays lit until the trade is actually answered — faking a seen state would
  // mean inventing a fact the server cannot confirm.
  const pendingIncoming = useMemo(
    () =>
      (trades ?? []).filter((t) => t.direction === "received" && t.status === "PENDING").length,
    [trades]
  );

  const pills = (
    <View style={styles.pills}>
      {FILTERS.map((f) => (
        <Pressable
          key={f}
          onPress={() => setFilter(f)}
          style={[styles.pill, filter === f && styles.pillActive]}
        >
          <Text style={[styles.pillText, filter === f && styles.pillTextActive]}>
            {copy.board.filters[f]}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  // ---- First load: nothing to show yet ----
  if (loading && trades === null) {
    return (
      <View style={styles.wrap}>
        {pills}
        <View style={styles.centered}>
          <ActivityIndicator color={colors.black} />
        </View>
      </View>
    );
  }

  // ---- Load failed with nothing cached ----
  // Distinct from a failed refresh: there are no rows to fall back to, so the
  // whole panel is the error — and the way into a new trade still has to work.
  if (trades === null) {
    return (
      <View style={styles.wrap}>
        {pills}
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.grey} />
          <Text style={styles.emptyTitle}>{copy.board.error.title}</Text>
          <Text style={styles.emptyBody}>{error ?? copy.board.error.body}</Text>
          <View style={styles.emptyActions}>
            <PrimaryButton label={copy.board.error.retry} onPress={retry} />
            <View style={styles.actionGap} />
            <PrimaryButton
              label={copy.board.error.action}
              variant="outline"
              onPress={startTrade}
            />
          </View>
        </View>
      </View>
    );
  }

  // ---- Populated, or one of the two empties ----
  const neverTraded = trades.length === 0;

  return (
    <View style={styles.wrap}>
      {pills}
      <FlatList
        data={visible}
        keyExtractor={(t) => t.id}
        contentContainerStyle={[styles.list, visible.length === 0 && styles.listEmpty]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View>
            {/* A refresh failed but earlier rows are still on screen. The rows
                stay; the banner says they are stale. */}
            {error !== null && (
              <View style={styles.staleBanner}>
                <Ionicons name="alert-circle-outline" size={15} color={colors.grey} />
                <Text style={styles.staleText}>{copy.board.refreshFailed}</Text>
              </View>
            )}

            {pendingIncoming > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countText}>
                  {fill(copy.board.pendingCount, { count: pendingIncoming })}
                </Text>
              </View>
            )}

            {!neverTraded && (
              <Pressable style={styles.startRow} onPress={startTrade}>
                <Ionicons name="add" size={18} color={colors.black} />
                <Text style={styles.startText}>{copy.board.startTrade}</Text>
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          neverTraded ? (
            // Never traded at all — the way in is the whole point of the state.
            <View style={styles.centered}>
              <Ionicons name="swap-horizontal" size={40} color={colors.grey} />
              <Text style={styles.emptyTitle}>{copy.board.emptyNever.title}</Text>
              <Text style={styles.emptyBody}>{copy.board.emptyNever.body}</Text>
              <View style={styles.emptyActions}>
                <PrimaryButton label={copy.board.emptyNever.action} onPress={startTrade} />
              </View>
            </View>
          ) : (
            // Has trades, none match the filter. Telling this person "no trades
            // yet" would be false, so the offer is a filter change instead.
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>{copy.board.emptyFiltered.title}</Text>
              <Text style={styles.emptyBody}>{copy.board.emptyFiltered.body}</Text>
              <View style={styles.emptyActions}>
                <PrimaryButton
                  label={copy.board.emptyFiltered.action}
                  variant="outline"
                  onPress={() => setFilter("all")}
                />
              </View>
            </View>
          )
        }
        renderItem={({ item }) => (
          <TradeRow trade={item} onPress={() => router.push(`/trade/${item.id}`)} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  pills: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  pill: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.black,
    borderRadius: radius.pill,
    paddingVertical: 9,
    alignItems: "center",
  },
  pillActive: { backgroundColor: colors.black },
  pillText: { fontFamily: fonts.bold, fontSize: 12, color: colors.black },
  pillTextActive: { color: colors.white },

  list: { paddingHorizontal: 16, paddingBottom: 24 },
  listEmpty: { flexGrow: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },

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

  countBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.black,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginBottom: 12,
  },
  countText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },

  startRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1.5,
    borderColor: colors.black,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 14,
  },
  startText: { fontFamily: fonts.bold, fontSize: 13, color: colors.black },
});
