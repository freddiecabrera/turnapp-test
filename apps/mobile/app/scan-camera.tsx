import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { TurnCoin } from "../src/components/TurnCoin";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { colors, fonts, radius } from "../src/theme";
import type { ScanResult } from "../src/types";

type Phase = "scanning" | "processing" | "result";

export default function ScanCamera() {
  const router = useRouter();
  const { refresh } = useAuth();
  const params = useLocalSearchParams<{ code?: string }>();
  const [permission, requestPermission] = useCameraPermissions();

  const [phase, setPhase] = useState<Phase>(params.code ? "processing" : "scanning");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  const processCode = useCallback(
    async (code: string) => {
      if (lock.current) return;
      lock.current = true;
      setPhase("processing");
      setError(null);
      try {
        const res = await api.scan(code);
        setResult(res);
        refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setPhase("result");
      }
    },
    [refresh]
  );

  // Manual-entry path: a code was passed in, submit immediately.
  useEffect(() => {
    if (params.code) processCode(String(params.code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    lock.current = false;
    setResult(null);
    setError(null);
    setPhase("scanning");
  }

  // ---- Processing ----
  if (phase === "processing") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.white} size="large" />
        <Text style={styles.processingText}>verifying...</Text>
      </View>
    );
  }

  // ---- Result (success / duplicate / error) ----
  if (phase === "result") {
    return (
      <SafeAreaView style={styles.resultSafe}>
        <Pressable style={styles.close} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={28} color={colors.white} />
        </Pressable>

        {error ? (
          <View style={styles.resultBody}>
            <Ionicons name="alert-circle" size={64} color="#ff8a80" />
            <Text style={styles.resultTitle}>couldn't collect</Text>
            <Text style={styles.resultSub}>{error}</Text>
            <View style={styles.resultActions}>
              <PrimaryButton label="try again" variant="outline" onPress={reset} />
            </View>
          </View>
        ) : result ? (
          <View style={styles.resultBody}>
            {result.card.imageUrl && (
              <Image source={{ uri: result.card.imageUrl }} style={styles.resultCard} />
            )}
            <Text style={styles.resultTitle}>
              {result.alreadyOwned ? "duplicate collected" : "card collected!"}
            </Text>
            <Text style={styles.resultCardName}>{result.card.name}</Text>

            {result.alreadyOwned ? (
              <Text style={styles.resultSub}>
                You already had this one — added to your stack (x{result.card.quantity}). No new
                points.
              </Text>
            ) : (
              <View style={styles.pointsRow}>
                <Text style={styles.pointsPlus}>+{result.pointsAwarded}</Text>
                <TurnCoin size={24} />
              </View>
            )}

            <Text style={styles.balance}>balance: {result.newBalance.toLocaleString()}</Text>

            <View style={styles.resultActions}>
              <PrimaryButton label="scan another" variant="outline" onPress={reset} />
              <View style={{ height: 12 }} />
              <PrimaryButton label="done" onPress={() => router.back()} />
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  // ---- Scanning (camera) ----
  if (!permission) {
    return <View style={styles.centered} />;
  }
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.resultSafe}>
        <Pressable style={styles.close} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={28} color={colors.white} />
        </Pressable>
        <View style={styles.resultBody}>
          <Ionicons name="camera" size={56} color={colors.white} />
          <Text style={styles.resultTitle}>camera access needed</Text>
          <Text style={styles.resultSub}>
            We use the camera to scan card QR codes. You can also enter a code manually.
          </Text>
          <View style={styles.resultActions}>
            <PrimaryButton label="allow camera" variant="outline" onPress={requestPermission} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => processCode(data)}
      />
      <SafeAreaView style={styles.cameraOverlay}>
        <Pressable style={styles.close} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={28} color={colors.white} />
        </Pressable>
        <View style={styles.frameWrap}>
          <View style={styles.frame} />
          <Text style={styles.frameHint}>point at the card's QR code</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: colors.black,
    alignItems: "center",
    justifyContent: "center",
  },
  processingText: { color: colors.white, fontFamily: fonts.regular, fontSize: 16, marginTop: 16 },

  resultSafe: { flex: 1, backgroundColor: colors.marble },
  close: { padding: 16 },
  resultBody: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  resultCard: {
    width: 180,
    height: 250,
    borderRadius: radius.md,
    marginBottom: 20,
  },
  resultTitle: { color: colors.white, fontFamily: fonts.bold, fontSize: 24, marginTop: 4 },
  resultCardName: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: fonts.regular,
    fontSize: 18,
    marginTop: 4,
  },
  resultSub: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: fonts.regular,
    fontSize: 15,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 22,
  },
  pointsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18 },
  pointsPlus: { color: colors.white, fontFamily: fonts.bold, fontSize: 34 },
  balance: { color: "rgba(255,255,255,0.6)", fontFamily: fonts.regular, fontSize: 14, marginTop: 12 },
  resultActions: { alignSelf: "stretch", marginTop: 32 },

  cameraWrap: { flex: 1, backgroundColor: colors.black },
  cameraOverlay: { flex: 1 },
  frameWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: {
    width: 240,
    height: 240,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: colors.white,
    backgroundColor: "transparent",
  },
  frameHint: {
    color: colors.white,
    fontFamily: fonts.bold,
    fontSize: 15,
    marginTop: 20,
  },
});
