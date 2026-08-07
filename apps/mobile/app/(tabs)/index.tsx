import { useCallback, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Brand } from "../../src/components/Brand";
import { TurnCoin } from "../../src/components/TurnCoin";
import { TierBar } from "../../src/components/TierBar";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, fonts, radius } from "../../src/theme";
import type { CardWithOwnership, WalletResponse } from "../../src/types";
import { POINT_TIERS } from "../../src/types";

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [cards, setCards] = useState<CardWithOwnership[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [w, c] = await Promise.all([api.wallet(), api.cards()]);
      setWallet(w);
      setCards(c);
    } catch {
      // keep any previously loaded data on transient errors
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const balance = wallet?.pointsBalance ?? user?.pointsBalance ?? 0;
  const ownedPreview = cards.filter((c) => c.owned && c.imageUrl).slice(0, 5);
  const retrovision = cards.find((c) => c.name.toLowerCase().includes("retrovision"));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.logoRow}>
          <Brand width={110} />
        </View>

        {/* Points card */}
        <View style={styles.pointsCard}>
          <View style={styles.pointsTop}>
            <Text style={styles.username}>@ {user?.username ?? ""}</Text>
            <View style={styles.help}>
              <Text style={styles.helpText}>?</Text>
            </View>
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.balance}>{balance.toLocaleString()}</Text>
            <TurnCoin size={30} />
          </View>
          <View style={{ marginTop: 8 }}>
            <TierBar balance={balance} tiers={wallet?.tiers ?? POINT_TIERS} onDark />
          </View>
          <Pressable style={styles.walletBtn} onPress={() => router.push("/wallet")}>
            <Text style={styles.walletBtnText}>your wallet</Text>
          </Pressable>
        </View>

        {/* SZN1 featured tile */}
        <Pressable style={styles.feature} onPress={() => router.push("/(tabs)/cards")}>
          <View style={styles.szn1Collage}>
            {ownedPreview.length > 0 ? (
              ownedPreview.map((c, i) => (
                <Image
                  key={c.id}
                  source={{ uri: c.imageUrl! }}
                  style={[styles.collageCard, { left: 16 + i * 58, top: 20 + (i % 2) * 10 }]}
                  resizeMode="cover"
                />
              ))
            ) : (
              <Text style={styles.featurePlaceholder}>start collecting</Text>
            )}
          </View>
          <Text style={styles.featureLabel}>SZN1</Text>
        </Pressable>

        {/* retrovision featured tile */}
        <Pressable
          style={styles.feature}
          onPress={() => retrovision && router.push(`/card/${retrovision.id}`)}
        >
          {retrovision?.owned && retrovision.imageUrl ? (
            <Image
              source={{ uri: retrovision.imageUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.featureDark]} />
          )}
          <View style={styles.featureScrim} />
          <Text style={[styles.featureLabel, { color: colors.white }]}>retrovision</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  content: { padding: 16, paddingBottom: 32 },
  logoRow: { alignItems: "center", paddingVertical: 8 },

  pointsCard: {
    backgroundColor: colors.marble,
    borderRadius: radius.lg,
    padding: 20,
    marginTop: 8,
  },
  pointsTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  username: { color: "rgba(255,255,255,0.85)", fontFamily: fonts.regular, fontSize: 16 },
  help: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  helpText: { fontFamily: fonts.bold, fontSize: 15, color: colors.black },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  balance: { color: colors.white, fontFamily: fonts.bold, fontSize: 46, letterSpacing: -1 },
  walletBtn: {
    alignSelf: "flex-end",
    marginTop: 4,
    borderWidth: 1.5,
    borderColor: colors.white,
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  walletBtnText: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },

  feature: {
    height: 200,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginTop: 16,
    backgroundColor: "#20242c",
    justifyContent: "flex-end",
  },
  featureDark: { backgroundColor: "#20242c" },
  featureScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.15)" },
  szn1Collage: { ...StyleSheet.absoluteFillObject },
  collageCard: {
    position: "absolute",
    width: 70,
    height: 98,
    borderRadius: 6,
    transform: [{ rotate: "-8deg" }],
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  featurePlaceholder: {
    color: "rgba(255,255,255,0.5)",
    fontFamily: fonts.regular,
    fontSize: 15,
    position: "absolute",
    top: 90,
    left: 20,
  },
  featureLabel: {
    fontFamily: fonts.bold,
    fontSize: 26,
    color: colors.white,
    margin: 16,
  },
});
