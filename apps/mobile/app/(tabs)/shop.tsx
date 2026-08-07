import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Brand } from "../../src/components/Brand";
import { ComingSoon } from "../../src/components/ComingSoon";
import { colors } from "../../src/theme";

export default function Shop() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.logoRow}>
        <Brand width={110} />
      </View>
      <ComingSoon
        icon="cart"
        title="the shop"
        subtitle="store locator and apparel drops will live here."
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  logoRow: { alignItems: "center", paddingVertical: 8 },
});
