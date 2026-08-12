import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { CardTile } from "../../src/components/CardTile";
import { TradingBoard } from "../../src/components/TradingBoard";
import { api } from "../../src/api";
import { colors, fonts } from "../../src/theme";
import type { CardWithOwnership } from "../../src/types";

const TABS = ["your status", "reward store", "trading board"] as const;
type TabKey = (typeof TABS)[number];

/**
 * A handle on each pill that is not its label.
 *
 * These three labels never went through `copy.ts` — they predate it and double
 * as the tab keys. Reaching for the trading pill by its wording would tie a
 * test to a string that is still the repo owner's to rewrite, so each pill
 * carries an id that survives the rewrite: `collectibles-tab-trading-board`.
 *
 * Not exported, because expo-router treats a route module's exports as part of
 * the route's contract.
 */
const tabTestID = (tab: TabKey) => `collectibles-tab-${tab.replace(/\s+/g, "-")}`;

export default function Cards() {
  const router = useRouter();
  const [cards, setCards] = useState<CardWithOwnership[]>([]);
  const [tab, setTab] = useState<TabKey>("your status");

  /**
   * The board is mounted the first time its pill is opened, and stays mounted.
   *
   * Rendering it inside the pill ternary unmounted it on every switch away,
   * which discarded the direction filter and the scroll offset and re-issued an
   * unbounded `GET /trades` on the way back — the same "list remounts, scroll
   * resets" failure filed against the live app's trading hub. Toggling `display`
   * instead leaves the list's state where the list is.
   *
   * The latch preserves the original reason for mounting the board here rather
   * than lifting its data up: someone who never opens this pill still issues no
   * trade request at all. What it costs is that once opened, the board's own
   * focus refresh runs whenever this tab is focused, including while the
   * collectibles grid is the visible pill.
   */
  const [boardOpened, setBoardOpened] = useState(false);

  const openTab = useCallback((next: TabKey) => {
    setTab(next);
    if (next === "trading board") setBoardOpened(true);
  }, []);

  const load = useCallback(async () => {
    try {
      setCards(await api.cards());
    } catch {
      // ignore transient errors
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const ownedCount = cards.filter((c) => c.owned).length;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>collectibles</Text>
        <Text style={styles.progress}>
          {ownedCount}/{cards.length} collected
        </Text>
      </View>

      <View style={styles.pills}>
        {TABS.map((t) => (
          <Pressable
            key={t}
            testID={tabTestID(t)}
            onPress={() => openTab(t)}
            style={[styles.pill, tab === t && styles.pillActive]}
          >
            <Text style={[styles.pillText, tab === t && styles.pillTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "your status" ? (
        <FlatList
          data={cards}
          keyExtractor={(c) => c.id}
          numColumns={3}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <CardTile card={item} onPress={() => router.push(`/card/${item.id}`)} />
            </View>
          )}
        />
      ) : tab === "reward store" ? (
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonTitle}>{tab}</Text>
          <Text style={styles.comingSoonText}>coming soon</Text>
        </View>
      ) : null}

      {boardOpened && (
        <View style={[styles.board, tab !== "trading board" && styles.boardHidden]}>
          <TradingBoard />
        </View>
      )}
    </SafeAreaView>
  );
}

const GAP = 10;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: { fontFamily: fonts.bold, fontSize: 26, color: colors.black },
  progress: { fontFamily: fonts.regular, fontSize: 14, color: colors.grey },
  pills: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  pill: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.black,
    borderRadius: 999,
    paddingVertical: 9,
    alignItems: "center",
  },
  pillActive: { backgroundColor: colors.black },
  pillText: { fontFamily: fonts.bold, fontSize: 12, color: colors.black },
  pillTextActive: { color: colors.white },
  grid: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { gap: GAP, marginBottom: GAP },
  cell: { flex: 1 },
  board: { flex: 1 },
  // `display: "none"` takes the board out of layout entirely while leaving it
  // mounted, which is the whole point: its list keeps its scroll offset.
  boardHidden: { display: "none" },
  comingSoon: { flex: 1, alignItems: "center", justifyContent: "center" },
  comingSoonTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.black },
  comingSoonText: { fontFamily: fonts.regular, fontSize: 15, color: colors.grey, marginTop: 6 },
});
