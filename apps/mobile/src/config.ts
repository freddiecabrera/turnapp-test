import Constants from "expo-constants";
import { Platform } from "react-native";

const API_PORT = 4000;

// The Expo dev server tells the app which host (your computer's LAN IP) it was
// loaded from, e.g. "10.0.0.75:8081". We reuse that host for the API so a real
// phone on the same Wi-Fi can reach it automatically — no per-machine config.
export function deriveDevHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as any).expoGoConfig?.debuggerHost ??
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ??
    null;
  if (!hostUri) return null;
  const host = hostUri.split(":")[0];
  return host || null;
}

export function resolveApiUrl(): string {
  // 1. Explicit override always wins (e.g. a tunnel or a deployed API).
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;

  // 2. Physical device / LAN: reuse the Expo dev server's host with the API port.
  const host = deriveDevHost();
  if (host) return `http://${host}:${API_PORT}`;

  // 3. Simulator / emulator fallbacks.
  return Platform.OS === "android"
    ? `http://10.0.2.2:${API_PORT}`
    : `http://localhost:${API_PORT}`;
}

export const API_URL = resolveApiUrl();

// Resolve a possibly-relative image path (e.g. "/static/cards/x.png") returned
// by the API into an absolute URL the device can load.
export function resolveImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("http")) return imageUrl;
  return `${API_URL}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
}
