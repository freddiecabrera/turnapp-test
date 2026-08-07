import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { TurnCoin } from "../../src/components/TurnCoin";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { useAuth } from "../../src/auth";
import { colors, fonts, radius } from "../../src/theme";

export default function Account() {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>account</Text>
      </View>

      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.username?.charAt(0).toUpperCase() ?? "T"}
          </Text>
        </View>
        <Text style={styles.name}>@ {user?.username ?? ""}</Text>
        <Text style={styles.sub}>user id: {user?.userIdNumber ?? "—"}</Text>
      </View>

      <View style={styles.rows}>
        <Row label="email" value={user?.email ?? "—"} />
        <Row
          label="points balance"
          value={(user?.pointsBalance ?? 0).toLocaleString()}
          coin
        />
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          label="your wallet"
          variant="outline"
          onPress={() => router.push("/wallet")}
        />
        <View style={{ height: 12 }} />
        <PrimaryButton label="log out" onPress={logout} />
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, coin }: { label: string; value: string; coin?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueWrap}>
        <Text style={styles.rowValue}>{value}</Text>
        {coin && <TurnCoin size={18} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  title: { fontFamily: fonts.bold, fontSize: 26, color: colors.black },
  profile: { alignItems: "center", paddingVertical: 24 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.marble,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.white, fontFamily: fonts.bold, fontSize: 34 },
  name: { fontFamily: fonts.bold, fontSize: 20, color: colors.black, marginTop: 12 },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: colors.grey, marginTop: 2 },
  rows: { paddingHorizontal: 16, marginTop: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGrey,
  },
  rowLabel: { fontFamily: fonts.regular, fontSize: 15, color: colors.grey },
  rowValueWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowValue: { fontFamily: fonts.bold, fontSize: 15, color: colors.black },
  actions: { padding: 16, marginTop: "auto" },
});
