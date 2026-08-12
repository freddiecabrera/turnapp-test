import { StyleSheet, Text, View } from "react-native";
import { copy, fill } from "../copy";
import { colors, fonts } from "../theme";

/**
 * How many steps the create-trade wizard has, in one place.
 *
 * Exported because the copy interpolates it — `copy.wizard.progress` reads
 * "Step {step} of {total}" and `{total}` has to come from the code, or the day
 * a step is added or removed the sentence quietly starts lying.
 */
export const WIZARD_STEPS = 4;

/**
 * The step indicator, drawn once and shown on all four wizard screens.
 *
 * A row of bars plus the sentence, rather than one or the other: the bars are
 * the at-a-glance answer to "how much is left", the sentence is what a screen
 * reader and a small display can actually use. Both come from the same numbers,
 * so they cannot disagree.
 *
 * `step` is 1-based, matching the sentence rather than the array index — the
 * off-by-one is paid once, here, instead of at four call sites.
 */
export function WizardProgress({ step }: { step: number }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {Array.from({ length: WIZARD_STEPS }, (_, i) => (
          <View key={i} style={[styles.bar, i < step && styles.barDone]} />
        ))}
      </View>
      <Text style={styles.label}>{fill(copy.wizard.progress, { step, total: WIZARD_STEPS })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, gap: 8 },
  bars: { flexDirection: "row", gap: 6 },
  bar: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.lightGrey,
  },
  barDone: { backgroundColor: colors.black },
  label: { fontFamily: fonts.regular, fontSize: 12, color: colors.grey },
});
