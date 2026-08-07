import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { rarityColor } from "../../src/components/CardTile";
import { api } from "../../src/api";
import { colors, fonts, radius } from "../../src/theme";
import type { CardWithOwnership } from "../../src/types";

export default function CardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [card, setCard] = useState<CardWithOwnership | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .card(id)
      .then(setCard)
      .catch((e) => setError((e as Error).message));
  }, [id]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Pressable style={styles.back} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={26} color={colors.black} />
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}

      {card && (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.artWrap}>
            {card.owned && card.imageUrl ? (
              <Image source={{ uri: card.imageUrl }} style={styles.art} resizeMode="contain" />
            ) : (
              <View style={styles.lockedArt}>
                <Image
                  source={require("../../assets/images/card-back.png")}
                  style={[styles.art, { opacity: 0.35 }]}
                  resizeMode="contain"
                />
                <View style={styles.lockOverlay}>
                  <Ionicons name="lock-closed" size={40} color="rgba(255,255,255,0.9)" />
                  <Text style={styles.lockText}>not yet collected</Text>
                </View>
              </View>
            )}
          </View>

          <View style={styles.headerRow}>
            <Text style={styles.name}>{card.name}</Text>
            {card.cardNumber && <Text style={styles.number}>{card.cardNumber}</Text>}
          </View>

          <View style={styles.chips}>
            {card.rarity && (
              <View style={[styles.chip, { backgroundColor: rarityColor(card.rarity) }]}>
                <Text style={styles.chipTextLight}>{card.rarity}</Text>
              </View>
            )}
            {card.type && (
              <View style={styles.chipOutline}>
                <Text style={styles.chipText}>{card.type}</Text>
              </View>
            )}
            {card.universe && (
              <View style={styles.chipOutline}>
                <Text style={styles.chipText}>{card.universe}</Text>
              </View>
            )}
          </View>

          {card.story && <Text style={styles.story}>{card.story}</Text>}

          <View style={styles.metaRow}>
            <Meta label="tier" value={card.rarityLevel ? `${card.rarityLevel} / 5` : "—"} />
            <Meta label="owned" value={card.owned ? `x${card.quantity}` : "no"} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.meta}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  back: { padding: 12 },
  error: { color: "#c0392b", fontFamily: fonts.regular, padding: 16 },
  content: { padding: 20, paddingBottom: 40 },
  artWrap: {
    height: 380,
    backgroundColor: "#f4f4f4",
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  art: { width: "100%", height: "100%" },
  lockedArt: { width: "100%", height: "100%", justifyContent: "center", alignItems: "center" },
  lockOverlay: { position: "absolute", alignItems: "center" },
  lockText: {
    color: colors.white,
    fontFamily: fonts.bold,
    fontSize: 14,
    marginTop: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
  },
  name: { fontFamily: fonts.bold, fontSize: 28, color: colors.black, flex: 1 },
  number: { fontFamily: fonts.regular, fontSize: 16, color: colors.grey },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOutline: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1.5,
    borderColor: colors.black,
  },
  chipText: { fontFamily: fonts.bold, fontSize: 12, color: colors.black },
  chipTextLight: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  story: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    color: "#333",
    marginTop: 18,
  },
  metaRow: { flexDirection: "row", gap: 12, marginTop: 24 },
  meta: {
    flex: 1,
    backgroundColor: "#f4f4f4",
    borderRadius: radius.md,
    padding: 16,
  },
  metaLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.grey },
  metaValue: { fontFamily: fonts.bold, fontSize: 18, color: colors.black, marginTop: 4 },
});
