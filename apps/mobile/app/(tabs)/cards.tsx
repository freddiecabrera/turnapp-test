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

export default function Cards() {
  const router = useRouter();
  const [cards, setCards] = useState<CardWithOwnership[]>([]);
  const [tab, setTab] = useState<TabKey>("your status");

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
            onPress={() => setTab(t)}
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
      ) : tab === "trading board" ? (
        // The board owns its own loading, refresh and error states, and does
        // its own focus refresh — mounting it here rather than lifting its data
        // up keeps `GET /trades` off the collection tab for anyone who never
        // opens this pill.
        <TradingBoard />
      ) : (
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonTitle}>{tab}</Text>
          <Text style={styles.comingSoonText}>coming soon</Text>
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
  comingSoon: { flex: 1, alignItems: "center", justifyContent: "center" },
  comingSoonTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.black },
  comingSoonText: { fontFamily: fonts.regular, fontSize: 15, color: colors.grey, marginTop: 6 },
});
