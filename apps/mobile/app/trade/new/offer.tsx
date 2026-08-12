import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { CardTile } from "../../../src/components/CardTile";
import { SelectableCell } from "../../../src/components/CardPicker";
import { PrimaryButton } from "../../../src/components/PrimaryButton";
import { WizardFooter, WizardNotice, WizardScreen } from "../../../src/components/WizardScreen";
import { api } from "../../../src/api";
import { copy } from "../../../src/copy";
import { colors } from "../../../src/theme";
import type { CardWithOwnership } from "../../../src/types";
import { chooseOffered, messageFor, useTradeDraft } from "../../../src/wizard";

/**
 * TH-11, step 2 of 4 — pick the card you are giving.
 *
 * Backed by `api.cards()`, the same call the collectibles grid makes: every
 * card in the season with `owned` and `quantity` on it, image URLs already
 * resolved. Ownership is filtered client-side because there is no
 * "my collection" endpoint — `GET /users/:id/cards` is for looking at somebody
 * *else* — and re-using the wired call is cheaper than adding one.
 *
 * That also makes the empty state exact rather than approximate: `owned` comes
 * from the server, so an account that owns nothing produces an empty filter,
 * not a failed request.
 *
 * **The empty state is a hard dead end.** A new account owns zero cards, so
 * there is no card to offer and no earlier step that changes that. It says so
 * and points at the only thing that helps, which is scanning — going back to
 * pick a different partner would be a suggestion that cannot work.
 */
export default function ChooseOffer() {
  const router = useRouter();
  const draft = useTradeDraft();

  const [cards, setCards] = useState<CardWithOwnership[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await api.cards();
      setCards(all.filter((c) => c.owned));
    } catch (e) {
      setCards(null);
      setError(messageFor(e, copy.wizard.offer.errorBody));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Deep-linked, or opened after the draft was lost. Step 1 is the only place
  // that can supply a partner, so there is nothing to render and nothing to ask
  // — send them to the step that answers it.
  if (draft.partner === null) return <Redirect href="/trade/new" />;

  const body = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.black} />
        </View>
      );
    }

    if (cards === null) {
      return (
        <WizardNotice
          icon="cloud-offline-outline"
          title={copy.wizard.offer.errorTitle}
          body={error ?? copy.wizard.offer.errorBody}
        >
          <PrimaryButton label={copy.wizard.retry} onPress={load} />
        </WizardNotice>
      );
    }

    if (cards.length === 0) {
      return (
        <WizardNotice
          icon="albums-outline"
          title={copy.wizard.offer.empty}
          body={copy.wizard.offer.emptyBody}
        >
          {/* `navigate`, not `push`: the tabs are already at the bottom of this
              stack, so this returns to them and selects scan rather than
              stacking a second copy of the tab navigator on top of the wizard. */}
          <PrimaryButton
            label={copy.wizard.offer.emptyAction}
            onPress={() => router.navigate("/(tabs)/scan")}
          />
        </WizardNotice>
      );
    }

    return (
      <FlatList
        data={cards}
        keyExtractor={(c) => c.id}
        numColumns={3}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <SelectableCell selected={draft.offered?.id === item.id}>
            {/* The real collectibles tile. These cards are genuinely
                `CardWithOwnership` with `owned: true`, so it draws art, badges
                duplicates, and claims nothing untrue. */}
            <CardTile card={item} onPress={() => chooseOffered(item)} />
          </SelectableCell>
        )}
      />
    );
  };

  return (
    <WizardScreen step={2} title={copy.wizard.offer.title}>
      {body()}
      {/* The footer is drawn only when there is something to advance from. On
          the dead end and the error state there is no next step, and a disabled
          button under either would be an affordance for a route that does not
          exist. */}
      {!loading && cards !== null && cards.length > 0 && (
        <WizardFooter>
          <PrimaryButton
            label={copy.wizard.continue}
            disabled={draft.offered === null}
            onPress={() => router.push("/trade/new/request")}
          />
        </WizardFooter>
      )}
    </WizardScreen>
  );
}

const GAP = 10;

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  grid: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { gap: GAP, marginBottom: GAP },
});
