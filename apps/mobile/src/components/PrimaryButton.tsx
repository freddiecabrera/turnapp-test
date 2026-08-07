import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors, fonts, radius } from "../theme";

export function PrimaryButton({
  label,
  onPress,
  variant = "solid",
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  variant?: "solid" | "outline";
  loading?: boolean;
  disabled?: boolean;
}) {
  const isOutline = variant === "outline";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        isOutline ? styles.outline : styles.solid,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isOutline ? colors.black : colors.white} />
      ) : (
        <Text style={[styles.label, { color: isOutline ? colors.black : colors.white }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  solid: { backgroundColor: colors.black },
  outline: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.black },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  label: { fontFamily: fonts.bold, fontSize: 16 },
});
