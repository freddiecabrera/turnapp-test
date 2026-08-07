import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { TurnCoin } from "../src/components/TurnCoin";
import { TierBar } from "../src/components/TierBar";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { colors, fonts } from "../src/theme";
import type { PointsTransaction, WalletResponse } from "../src/types";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${mm}/${dd}/${yy}`;
}

export default function Wallet() {
  const { user } = useAuth();
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [tab, setTab] = useState<"history" | "gift card">("history");

  useEffect(() => {
    api.wallet().then(setWallet).catch(() => {});
  }, []);

  const balance = wallet?.pointsBalance ?? user?.pointsBalance ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.white} />
        </Pressable>
        <Text style={styles.topTitle}>your wallet</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.userRow}>
        <View>
          <Text style={styles.name}>{user?.username ?? ""}</Text>
          <Text style={styles.userId}>user id: {user?.userIdNumber ?? "—"}</Text>
        </View>
        <View style={styles.balanceWrap}>
          <Text style={styles.balance}>{balance.toLocaleString()}</Text>
          <TurnCoin size={28} />
        </View>
      </View>

      <View style={styles.tierWrap}>
        <TierBar balance={balance} tiers={wallet?.tiers ?? []} onDark />
      </View>

      <View style={styles.tabs}>
        {(["history", "gift card"] as const).map((t) => (
          <Pressable key={t} style={styles.tab} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
            {tab === t && <View style={styles.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      {tab === "history" ? (
        <FlatList
          data={wallet?.transactions ?? []}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <TransactionRow tx={item} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      ) : (
        <View style={styles.giftCard}>
          <Text style={styles.giftText}>no gift cards yet</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function TransactionRow({ tx }: { tx: PointsTransaction }) {
  return (
    <View style={styles.txRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.txDate}>{formatDate(tx.createdAt)}</Text>
        <Text style={styles.txDesc} numberOfLines={2}>
          {tx.description}
        </Text>
      </View>
      <View style={styles.txAmountWrap}>
        <Text style={styles.txAmount}>
          {tx.amount >= 0 ? "+ " : "- "}
          {Math.abs(tx.amount)}
        </Text>
        <TurnCoin size={20} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.marble },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  topTitle: { color: colors.white, fontFamily: fonts.bold, fontSize: 20 },
  userRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  name: { color: colors.white, fontFamily: fonts.bold, fontSize: 24 },
  userId: { color: "rgba(255,255,255,0.5)", fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  balanceWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  balance: { color: colors.white, fontFamily: fonts.bold, fontSize: 34 },
  tierWrap: { paddingHorizontal: 20, paddingTop: 18 },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: 20,
    marginTop: 22,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  tab: { flex: 1, alignItems: "center", paddingBottom: 12 },
  tabText: { color: "rgba(255,255,255,0.5)", fontFamily: fonts.bold, fontSize: 15 },
  tabTextActive: { color: colors.white },
  tabUnderline: {
    position: "absolute",
    bottom: -1,
    height: 2,
    width: "70%",
    backgroundColor: colors.white,
  },
  list: { paddingHorizontal: 20, paddingTop: 8 },
  txRow: { flexDirection: "row", alignItems: "center", paddingVertical: 16 },
  txDate: { color: "rgba(255,255,255,0.55)", fontFamily: fonts.regular, fontSize: 13 },
  txDesc: { color: colors.white, fontFamily: fonts.bold, fontSize: 15, marginTop: 4 },
  txAmountWrap: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 12 },
  txAmount: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  sep: { height: 1, backgroundColor: "rgba(255,255,255,0.08)" },
  giftCard: { flex: 1, alignItems: "center", justifyContent: "center" },
  giftText: { color: "rgba(255,255,255,0.5)", fontFamily: fonts.regular, fontSize: 15 },
});
