import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, radius } from "../theme";
import type { CardWithOwnership } from "../types";

export const RARITY_COLORS: Record<string, string> = {
  daycard: "#9aa0a6",
  glow: "#5bc0de",
  pulse: "#f5a623",
  mythic: "#b06ef0",
  heavenmade: "#d9a520",
};

export function rarityColor(rarity: string | null): string {
  return (rarity && RARITY_COLORS[rarity]) || colors.lightGrey;
}

export function CardTile({
  card,
  onPress,
}: {
  card: CardWithOwnership;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.wrap} onPress={onPress}>
      <View style={styles.imageBox}>
        {card.owned && card.imageUrl ? (
          <Image source={{ uri: card.imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.locked}>
            <Image
              source={require("../../assets/images/card-back.png")}
              style={styles.lockedImage}
              resizeMode="cover"
            />
            <View style={styles.lockOverlay}>
              <Ionicons name="lock-closed" size={26} color="rgba(255,255,255,0.85)" />
            </View>
          </View>
        )}

        {card.quantity > 1 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{card.quantity}</Text>
          </View>
        )}
      </View>
      <View style={[styles.accent, { backgroundColor: rarityColor(card.rarity) }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  imageBox: {
    aspectRatio: 0.7,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: "#efefef",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  locked: {
    width: "100%",
    height: "100%",
  },
  lockedImage: {
    width: "100%",
    height: "100%",
    opacity: 0.35,
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(120,120,120,0.35)",
  },
  badge: {
    position: "absolute",
    top: 6,
    right: 6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: colors.white,
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  accent: {
    height: 3,
    borderRadius: 2,
    marginTop: 6,
    width: "70%",
    alignSelf: "center",
  },
});
