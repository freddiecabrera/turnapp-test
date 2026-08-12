import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { PrimaryButton } from "../../../src/components/PrimaryButton";
import { WizardNotice, WizardScreen } from "../../../src/components/WizardScreen";
import { api } from "../../../src/api";
import { useAuth } from "../../../src/auth";
import { copy, fill } from "../../../src/copy";
import { colors, fonts, radius } from "../../../src/theme";
import type { UserSummary } from "../../../src/types";
import { choosePartner, messageFor, resetDraft, useTradeDraft } from "../../../src/wizard";

/**
 * TH-11, step 1 of 4 — find someone to trade with.
 *
 * Backed by `GET /users/search?q=`, which matches a username on any part of it,
 * case-insensitively, plus an exact `userIdNumber` when `q` parses as one. It
 * excludes the caller and every staff account, deduplicates, and is capped at
 * twenty with no pagination and no total count — so this screen can offer a
 * "type more" hint and can never say how many people matched.
 *
 * **Idle and empty are different screens.** The endpoint answers `200 []` for
 * an empty or whitespace-only query *without running a query*, which means a
 * client that only looked at the response could not tell "you haven't typed
 * anything" from "nobody is called that". This one knows, because it knows what
 * was typed — so an empty box never issues a request at all, and the two states
 * are decided here rather than inferred from an ambiguous answer.
 */

/** Long enough that a typed word is one request, short enough not to feel laggy. */
const DEBOUNCE_MS = 300;

/**
 * The server's cap, mirrored so the "showing the first N" hint knows when to
 * appear. It is not a page size — there is no second page — so this is only
 * ever used to detect that the list was truncated.
 */
const SEARCH_LIMIT = 20;

export default function ChoosePartner() {
  const router = useRouter();
  const { user } = useAuth();
  const draft = useTradeDraft();

  const [query, setQuery] = useState("");
  // `null` is "no search has answered", which is what the idle state and a
  // failed search have in common and what an empty array does not mean: `[]` is
  // a successful search that matched nobody.
  const [results, setResults] = useState<UserSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the retry button. It is an effect dependency rather than a
  // separate request path, so retrying re-runs the one piece of search logic
  // instead of a second copy of it that can drift from the first.
  const [attempt, setAttempt] = useState(0);

  // Only the most recent search may write. Debouncing narrows the window but
  // does not close it — a slow request for "ta" can still land after a fast one
  // for "tayl" — and the visible symptom is results that do not match the box.
  const runId = useRef(0);

  // Once per run of the wizard. Pushing forward and popping back do not remount
  // a stack screen, so this cannot wipe a selection mid-flow; the only way here
  // again is to open the wizard afresh, which is exactly when a stale draft
  // from a previous run has to go.
  useEffect(() => {
    resetDraft();
  }, []);

  useEffect(() => {
    const q = query.trim();

    if (!q) {
      // Idle. No request: the server would answer `[]` without looking, and
      // storing that would turn "nothing typed" into "nothing found".
      runId.current++;
      setResults(null);
      setSearching(false);
      setError(null);
      return;
    }

    const id = ++runId.current;
    setSearching(true);

    const timer = setTimeout(() => {
      api
        .searchUsers(q)
        .then((found) => {
          if (id !== runId.current) return;
          setResults(found);
          setError(null);
        })
        .catch((e: unknown) => {
          if (id !== runId.current) return;
          setResults(null);
          setError(messageFor(e, copy.wizard.partner.errorBody));
        })
        .finally(() => {
          if (id === runId.current) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, attempt]);

  // Staff cannot send trades — `POST /trades` refuses on `req.auth.isAdmin`
  // before it validates anything else, so every step after this one would be
  // wasted work ending in a 400. The claim is on the token this client already
  // holds, so the dead end is reported at the entrance instead of at the exit.
  if (user?.isAdmin) {
    return (
      <WizardScreen step={1} title={copy.wizard.partner.title}>
        <WizardNotice
          icon="lock-closed-outline"
          title={copy.wizard.blocked.title}
          body={copy.wizard.blocked.body}
        />
      </WizardScreen>
    );
  }

  const searched = query.trim() !== "";
  const truncated = results !== null && results.length >= SEARCH_LIMIT;

  const body = () => {
    if (!searched) {
      // Idle. Nothing has been asked, so nothing has failed.
      return <WizardNotice icon="search-outline" title={copy.wizard.partner.prompt} />;
    }

    if (searching && results === null) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.black} />
        </View>
      );
    }

    if (error !== null) {
      return (
        <WizardNotice
          icon="cloud-offline-outline"
          title={copy.wizard.partner.errorTitle}
          body={error}
        >
          <PrimaryButton label={copy.wizard.retry} onPress={() => setAttempt((a) => a + 1)} />
        </WizardNotice>
      );
    }

    if (results !== null && results.length === 0) {
      return (
        <WizardNotice
          icon="person-outline"
          title={copy.wizard.partner.empty}
          hint={copy.wizard.partner.emptyHint}
        />
      );
    }

    return (
      <FlatList
        data={results ?? []}
        keyExtractor={(u) => u.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={
          truncated ? (
            <Text style={styles.capped}>
              {fill(copy.wizard.partner.capped, { count: results?.length ?? 0 })}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              choosePartner(item);
              router.push("/trade/new/offer");
            }}
            style={({ pressed }) => [
              styles.row,
              draft.partner?.id === item.id && styles.rowChosen,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.rowText}>
              <Text style={styles.username} numberOfLines={1}>
                @{item.username}
              </Text>
              <Text style={styles.userId}>
                {fill(copy.wizard.partner.idFormat, { id: item.userIdNumber })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.black} />
          </Pressable>
        )}
      />
    );
  };

  return (
    <WizardScreen step={1} title={copy.wizard.partner.title}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.grey} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
          placeholder={copy.wizard.partner.searchPlaceholder}
          placeholderTextColor={colors.grey}
        />
        {/* Only once results are on screen. With nothing to sit beside, the
            spinner below is the whole state instead. */}
        {searching && results !== null && <ActivityIndicator color={colors.grey} />}
        {query !== "" && !searching && (
          <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityRole="button">
            <Ionicons name="close-circle" size={18} color={colors.grey} />
          </Pressable>
        )}
      </View>

      {body()}
    </WizardScreen>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    height: 52,
    borderWidth: 1.5,
    borderColor: colors.lightGrey,
    borderRadius: radius.sm,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.black },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1.5,
    borderColor: colors.lightGrey,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  // The person already chosen, when you come back to change your mind.
  rowChosen: { borderColor: colors.black },
  pressed: { opacity: 0.85 },
  rowText: { flex: 1 },
  username: { fontFamily: fonts.bold, fontSize: 16, color: colors.black },
  userId: { fontFamily: fonts.regular, fontSize: 13, color: colors.grey, marginTop: 2 },
  capped: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.grey,
    textAlign: "center",
    marginTop: 6,
  },
});
