import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { PrimaryButton } from "../../../src/components/PrimaryButton";
import { TradeCards } from "../../../src/components/TradeCards";
import {
  ActionGap,
  WizardFooter,
  WizardNotice,
  WizardScreen,
} from "../../../src/components/WizardScreen";
import { ApiError, api } from "../../../src/api";
import { copy, fill } from "../../../src/copy";
import { colors, fonts } from "../../../src/theme";
import type { Trade } from "../../../src/types";
import { messageFor, useTradeDraft } from "../../../src/wizard";

/**
 * TH-11, step 4 of 4 — check the offer, then send it.
 *
 * The pair is drawn by `TradeCards` with `direction="sent"`, which is the truth
 * about a trade being composed by its sender: the offered card is the one being
 * given up and the requested one is what comes back. Nothing here re-derives
 * that inversion, because the board and the approve screen do not either.
 *
 * `POST /trades` answers `201` with the whole `Trade` — status, direction,
 * fulfillability, both parties, both cards — so the confirmation is rendered
 * from the response and needs no follow-up request. The board is left to
 * refresh itself on focus, which it already does, and `createdAt DESC` puts the
 * new row first.
 */

/**
 * Which way out to offer for a failed send.
 *
 * `POST /trades` documents thirteen refusals. They collapse into three
 * recoveries, because a person does not need thirteen answers — they need to
 * know whether to change something, go look at something, or stop:
 *
 * - **`board`** — 409, the only one. This exact offer already exists and is
 *   pending, so the thing to do is go and look at it.
 * - **`repick`** — every 400 and 404 that survives to here. Something chosen
 *   earlier stopped being true: a card one side no longer owns, a person who no
 *   longer exists. All three "change what you picked" buttons are offered, and
 *   the server's own sentence above them says which one to press.
 * - **`retry`** — a 500, or a rejected fetch that never reached the server.
 *   Nothing to change; the same request may simply work.
 *
 * The third documented recovery — you cannot do this at all — is the two staff
 * refusals, and neither survives to here. The sender-is-staff case is caught at
 * step 1 from the token, before four steps of work; the recipient-is-staff case
 * cannot be composed, because search excludes staff from the results this
 * partner was chosen from. If one ever did arrive it lands in `repick`, whose
 * "choose someone else" is the correct move for it anyway.
 *
 * Deliberately switching on `status`, never on the message. Those sentences are
 * the server's to reword; a client that branches on their text breaks silently
 * the first time one is improved.
 */
type Recovery = "board" | "repick" | "retry";

function recoveryFor(error: unknown): Recovery {
  if (!(error instanceof ApiError)) return "retry";
  if (error.status === 409) return "board";
  if (error.status === 400 || error.status === 404) return "repick";
  return "retry";
}

export default function ReviewOffer() {
  const router = useRouter();
  const draft = useTradeDraft();

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Trade | null>(null);
  const [failure, setFailure] = useState<{ message: string; recovery: Recovery } | null>(null);

  const { partner, offered, requested } = draft;

  // Back to the board, out of the whole wizard. Every step is on the root
  // stack, so this is one call rather than a walk back through four screens.
  const toBoard = () => router.dismissAll();

  async function send() {
    if (partner === null || offered === null || requested === null) return;
    setSending(true);
    setFailure(null);
    try {
      setSent(await api.createTrade(partner.id, offered.id, requested.id));
    } catch (e) {
      setFailure({
        message: messageFor(e, copy.wizard.review.error.body),
        recovery: recoveryFor(e),
      });
    } finally {
      setSending(false);
    }
  }

  // Guarded after `sent` on purpose. The draft is not cleared on success — the
  // confirmation renders from the response, not from the draft — but ordering
  // these the other way would make the screen depend on that never changing.
  if (sent === null && (partner === null || offered === null || requested === null)) {
    return <Redirect href="/trade/new" />;
  }

  if (sent !== null) {
    return (
      <WizardScreen step={4} title={copy.wizard.review.title} canGoBack={false}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.sentHead}>
            <Ionicons name="checkmark-circle" size={40} color={colors.black} />
            <Text style={styles.sentTitle}>{copy.wizard.review.success}</Text>
            <Text style={styles.sentBody}>{copy.wizard.review.successBody}</Text>
          </View>

          {/* Drawn from the response rather than the draft: this is the trade
              that exists, as the server serialized it for this viewer. */}
          <TradeCards
            direction={sent.direction}
            offeredCard={sent.offeredCard}
            requestedCard={sent.requestedCard}
            size="detail"
          />
        </ScrollView>

        <WizardFooter>
          <PrimaryButton label={copy.wizard.review.successAction} onPress={toBoard} />
        </WizardFooter>
      </WizardScreen>
    );
  }

  if (failure !== null) {
    return (
      <WizardScreen step={4} title={copy.wizard.review.title}>
        <WizardNotice
          icon="alert-circle-outline"
          title={copy.wizard.review.error.title}
          // The server's sentence when there was one; `messageFor` has already
          // replaced a raw fetch diagnostic with copy.
          body={failure.message}
        >
          {failure.recovery === "board" ? (
            <PrimaryButton label={copy.wizard.review.error.board} onPress={toBoard} />
          ) : failure.recovery === "repick" ? (
            <>
              <PrimaryButton
                label={copy.wizard.review.error.changeRequest}
                onPress={() => router.back()}
              />
              <ActionGap />
              <PrimaryButton
                label={copy.wizard.review.error.changeOffer}
                variant="outline"
                onPress={() => router.dismissTo("/trade/new/offer")}
              />
              <ActionGap />
              <PrimaryButton
                label={copy.wizard.review.error.changePartner}
                variant="outline"
                onPress={() => router.dismissTo("/trade/new")}
              />
            </>
          ) : (
            <>
              <PrimaryButton label={copy.wizard.review.error.retry} onPress={send} />
              <ActionGap />
              <PrimaryButton
                label={copy.wizard.review.cancel}
                variant="outline"
                onPress={toBoard}
              />
            </>
          )}
        </WizardNotice>
      </WizardScreen>
    );
  }

  // `sent` and `failure` are both null here, and the redirect above has already
  // established that all three selections exist — but TypeScript cannot carry
  // that across the branches, so this narrows them once for the render.
  if (partner === null || offered === null || requested === null) return null;

  return (
    <WizardScreen step={4} title={copy.wizard.review.title}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.to}>{fill(copy.wizard.review.to, { username: partner.username })}</Text>
        <TradeCards
          direction="sent"
          offeredCard={offered}
          requestedCard={requested}
          size="detail"
        />
      </ScrollView>

      <WizardFooter>
        <PrimaryButton label={copy.wizard.review.confirm} loading={sending} onPress={send} />
        <ActionGap />
        <PrimaryButton
          label={copy.wizard.review.cancel}
          variant="outline"
          disabled={sending}
          onPress={toBoard}
        />
      </WizardFooter>
    </WizardScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  to: { fontFamily: fonts.bold, fontSize: 15, color: colors.black, marginBottom: 18 },

  sentHead: { alignItems: "center", marginBottom: 28 },
  sentTitle: { fontFamily: fonts.bold, fontSize: 22, color: colors.black, marginTop: 12 },
  sentBody: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.grey,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
  },
});
