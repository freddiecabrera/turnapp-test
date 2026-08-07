import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Brand } from "../src/components/Brand";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { useAuth } from "../src/auth";
import { colors, fonts, radius } from "../src/theme";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("testing@turn.app");
  const [password, setPassword] = useState("turn123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <View style={styles.header}>
          <Brand variant="white" width={140} />
          <Text style={styles.tagline}>recognized by those who run the game</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@turn.app"
            placeholderTextColor={colors.grey}
          />
          <Text style={styles.label}>password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="password"
            placeholderTextColor={colors.grey}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={{ marginTop: 20 }}>
            <PrimaryButton label="sign in" onPress={submit} loading={busy} variant="outline" />
          </View>

          <Text style={styles.hint}>demo: testing@turn.app / turn123</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.black },
  container: { flex: 1, paddingHorizontal: 28, justifyContent: "center" },
  header: { alignItems: "center", marginBottom: 40 },
  tagline: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: fonts.script,
    fontSize: 16,
    marginTop: 14,
    textAlign: "center",
  },
  form: {},
  label: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: fonts.bold,
    fontSize: 13,
    marginBottom: 8,
    marginTop: 14,
    textTransform: "lowercase",
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    height: 50,
    color: colors.white,
    fontFamily: fonts.regular,
    fontSize: 16,
  },
  error: { color: "#ff8a80", fontFamily: fonts.regular, marginTop: 14 },
  hint: {
    color: "rgba(255,255,255,0.4)",
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: "center",
    marginTop: 22,
  },
});
