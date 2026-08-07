import { useEffect } from "react";
import { useFonts } from "expo-font";
import { SplashScreen, Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/auth";

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "login";
    if (!user && !inAuthGroup) {
      router.replace("/login");
    } else if (user && inAuthGroup) {
      router.replace("/");
    }
  }, [user, loading, segments]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="card/[id]" options={{ presentation: "card" }} />
      <Stack.Screen name="wallet" options={{ presentation: "modal" }} />
      <Stack.Screen name="scan-camera" options={{ presentation: "fullScreenModal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    "TurnNuevo-Bold": require("../assets/fonts/TurnNuevo-Bold.ttf"),
    "TurnNuevo-Regular": require("../assets/fonts/TurnNuevo-Regular.ttf"),
    "BiroScriptPlus": require("../assets/fonts/BiroScriptPlus.ttf"),
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
