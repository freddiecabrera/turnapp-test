import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "../theme";

function tierLabel(value: number): string {
  if (value >= 1000) return `${value / 1000}k`;
  return `${value}`;
}

// Progress bar with the five loyalty tier ticks (100 / 500 / 1k / 5k / 10k).
// Ticks are evenly spaced; the fill interpolates the balance between them.
export function TierBar({
  balance,
  tiers,
  onDark = true,
}: {
  balance: number;
  tiers: number[];
  onDark?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const n = tiers.length;

  const fraction = (() => {
    if (n === 0) return 0;
    if (balance <= tiers[0]) return (balance / tiers[0]) * (1 / (n - 1)) * 0.5;
    for (let i = 0; i < n - 1; i++) {
      if (balance <= tiers[i + 1]) {
        const segFrac = (balance - tiers[i]) / (tiers[i + 1] - tiers[i]);
        return (i + segFrac) / (n - 1);
      }
    }
    return 1;
  })();

  const trackColor = onDark ? "rgba(255,255,255,0.25)" : colors.lightGrey;
  const fillColor = onDark ? colors.white : colors.black;
  const labelColor = onDark ? "rgba(255,255,255,0.7)" : colors.grey;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={[styles.track, { backgroundColor: trackColor }]}>
        <View
          style={[styles.fill, { backgroundColor: fillColor, width: Math.max(6, width * fraction) }]}
        />
      </View>
      <View style={styles.labels}>
        {tiers.map((t) => (
          <Text key={t} style={[styles.label, { color: labelColor }]}>
            {tierLabel(t)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: 12,
  },
});
