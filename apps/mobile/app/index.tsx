import { Redirect } from "expo-router";

// The tab group is the real home; this just forwards there. Auth gating in the
// root layout will bounce unauthenticated users to /login.
export default function Index() {
  return <Redirect href="/(tabs)" />;
}
