import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { WizardProgress } from "./WizardProgress";
import { copy } from "../copy";
import { colors, fonts } from "../theme";

/**
 * The frame every create-trade step draws: back control, progress, title, body.
 *
 * The back control is the screen's own, not a header's. The root `Stack` sets
 * `headerShown: false` globally, so every screen in this app draws its own —
 * `app/card/[id].tsx` established the bare chevron and this is the same one.
 * It calls `router.back()` unconditionally, which is right on all four steps:
 * from steps 2, 3 and the review it returns to the previous step with its
 * selections intact, and from step 1 it leaves the wizard for the board.
 *
 * `title` is a prop rather than a slot read in here, because step 3's title
 * interpolates the partner's username and the caller is the only thing that
 * knows it. Every value passed still comes from `copy.ts`.
 */
export function WizardScreen({
  step,
  title,
  children,
}: {
  /** 1-based, matching `copy.wizard.progress`. */
  step: number;
  title: string;
  children: ReactNode;
}) {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Pressable
        style={styles.back}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel={copy.wizard.back}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={26} color={colors.black} />
      </Pressable>

      <WizardProgress step={step} />
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>

      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

/**
 * A full-panel message with an icon, a headline and up to a few ways out.
 *
 * Every non-list state in the wizard is one of these — loading is the exception
 * and the rest (nothing typed yet, nothing found, load failed, they own
 * nothing, you own nothing, sending failed, sent) differ only in wording and in
 * which buttons appear. Building them from one component is what keeps the
 * eleven of them from drifting into eleven layouts.
 *
 * Actions are passed as children rather than as a list of `{label, onPress}`,
 * so a state that wants an outline button second, or no button at all, says so
 * directly instead of through a prop that has to grow a variant for each case.
 */
export function WizardNotice({
  icon,
  title,
  body,
  hint,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** Omitted, never passed as `undefined` — `exactOptionalPropertyTypes` is on. */
  body?: string;
  /** A second, quieter line under `body`. Same rule. */
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.notice}>
      <Ionicons name={icon} size={40} color={colors.grey} />
      <Text style={styles.noticeTitle}>{title}</Text>
      {body !== undefined && <Text style={styles.noticeBody}>{body}</Text>}
      {hint !== undefined && <Text style={styles.noticeHint}>{hint}</Text>}
      {children !== undefined && <View style={styles.noticeActions}>{children}</View>}
    </View>
  );
}

/** Vertical spacing between two stacked buttons in a `WizardNotice`. */
export function ActionGap() {
  return <View style={styles.actionGap} />;
}

/**
 * The bar the advance button sits in, pinned under a picker grid.
 *
 * Separate from the grid's own padding so the button keeps its position when
 * the list is short enough not to scroll, and so the grid can scroll behind a
 * background rather than under a floating control.
 */
export function WizardFooter({ children }: { children: ReactNode }) {
  return <View style={styles.footer}>{children}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  back: { padding: 12, alignSelf: "flex-start" },
  title: {
    fontFamily: fonts.bold,
    fontSize: 26,
    color: colors.black,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  body: { flex: 1 },

  notice: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  noticeTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.black,
    marginTop: 14,
    textAlign: "center",
  },
  noticeBody: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.grey,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
  },
  noticeHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.grey,
    textAlign: "center",
    marginTop: 10,
    lineHeight: 19,
  },
  noticeActions: { alignSelf: "stretch", marginTop: 26 },
  actionGap: { height: 12 },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: colors.lightGrey,
    backgroundColor: colors.white,
  },
});
