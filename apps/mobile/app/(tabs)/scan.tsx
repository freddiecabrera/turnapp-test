import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Brand } from "../../src/components/Brand";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { colors, fonts, radius } from "../../src/theme";

const STEPS: { n: number; title: string; body: string }[] = [
  { n: 1, title: "find your insert", body: "Find your insert inside the package." },
  { n: 2, title: "reveal the code", body: "Locate the verification sticker and scratch to reveal the QR code." },
  { n: 3, title: "scan it", body: "Scan the QR code using the in-app scanner below." },
  { n: 4, title: "claim", body: "After verification, collect the card and claim your points." },
];

export default function Scan() {
  const router = useRouter();
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");

  function submitManual() {
    const trimmed = code.trim();
    if (!trimmed) return;
    router.push({ pathname: "/scan-camera", params: { code: trimmed } });
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.logoRow}>
          <Brand width={110} />
        </View>

        <Text style={styles.title}>scan | redeem</Text>

        <View style={styles.steps}>
          {STEPS.map((s) => (
            <View key={s.n} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{s.n}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepBody}>{s.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <PrimaryButton label="scan now" onPress={() => router.push("/scan-camera")} />

        <Text style={styles.or}>or</Text>

        {!manual ? (
          <Text style={styles.manualLink} onPress={() => setManual(true)}>
            enter a code manually
          </Text>
        ) : (
          <View style={styles.manualBox}>
            <View style={styles.manualInputRow}>
              <Ionicons name="keypad-outline" size={20} color={colors.grey} />
              <TextInput
                style={styles.manualInput}
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="TURN-XXXXXXXX"
                placeholderTextColor={colors.grey}
                onSubmitEditing={submitManual}
              />
            </View>
            <PrimaryButton label="collect" variant="outline" onPress={submitManual} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  content: { padding: 20, paddingBottom: 40 },
  logoRow: { alignItems: "center", paddingVertical: 8 },
  title: { fontFamily: fonts.bold, fontSize: 24, color: colors.black, marginTop: 8, marginBottom: 16 },
  steps: {
    borderWidth: 1,
    borderColor: colors.lightGrey,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 24,
    gap: 16,
  },
  step: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.black,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  stepTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.black },
  stepBody: { fontFamily: fonts.regular, fontSize: 14, color: colors.grey, marginTop: 2 },
  or: { textAlign: "center", color: colors.grey, fontFamily: fonts.regular, marginVertical: 16 },
  manualLink: {
    textAlign: "center",
    color: colors.black,
    fontFamily: fonts.bold,
    fontSize: 15,
    textDecorationLine: "underline",
  },
  manualBox: { gap: 12 },
  manualInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.lightGrey,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    height: 52,
  },
  manualInput: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.black },
});
