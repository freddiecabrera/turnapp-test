import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import TradeReview from "../app/trade/[id]";
import { ApiError, api } from "../src/api";
import { GET_TEST_ID, GIVE_TEST_ID } from "../src/components/TradeCards";
import { STATUS_KEY } from "../src/components/TradeRow";
import { copy, fill } from "../src/copy";
import type { Trade } from "../src/types";
import {
  OFFERED_NAME,
  REQUESTED_NAME,
  deferred,
  ownedCard,
  routerSpy,
  trade,
  type RouterSpy,
} from "../test/trading";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

// The screen is a `SafeAreaView` under the root provider it never sees in a
// test. The library ships no usable jest mock, and the insets are irrelevant to
// everything here, so the view is a plain one.
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({}) };
});

jest.mock("expo-router", () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));

// `ApiError` is kept real: `answerRecoveryFor` branches on `instanceof`, so a
// stubbed class would send every failure down the retry path and the
// classification under test would never run.
jest.mock("../src/api", () => ({
  ...jest.requireActual("../src/api"),
  api: {
    trades: jest.fn(),
    cards: jest.fn(),
    acceptTrade: jest.fn(),
    declineTrade: jest.fn(),
  },
}));

const mockApi = jest.mocked(api);

/**
 * TH-12's approve/decline screen.
 *
 * Two claims carry this file. The screen does **not** match on the server's 409
 * sentences — it re-reads `GET /trades` after a refused answer and classifies
 * from the trade's own state, because those sentences are rewritable copy and a
 * client that read them would pick the wrong recovery with no error anywhere.
 * And accept and decline race server-side, so while either is in flight both
 * must be dead: a user who fires both gets one 200 and one 409.
 *
 * Every mocked rejection carries an obvious fixture sentence rather than a real
 * one out of `routes/trades.ts`. What the server says is the server's to
 * change; what this screen does with a *status code* is not.
 */

const SERVER_SENTENCE = "server said no";

let router: RouterSpy;

beforeEach(() => {
  // `resetAllMocks`, not `clearAllMocks`: the latter empties `mock.calls` but
  // leaves a `mockResolvedValueOnce` queue intact, so an unconsumed one-shot
  // answer becomes the *next* case's first response.
  jest.resetAllMocks();
  router = routerSpy();
  (useRouter as jest.Mock).mockReturnValue(router);
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: "trade-1" });
  mockApi.cards.mockResolvedValue([]);
});

/** Mount with a board containing exactly this trade, and wait for it to draw. */
async function open(overrides: Partial<Trade> = {}): Promise<Trade> {
  const t = trade(overrides);
  mockApi.trades.mockResolvedValue([t]);
  render(<TradeReview />);
  await screen.findByText(copy.review.title);
  return t;
}

/** Walk from the review state into one answer's confirmation. */
async function confirm(answer: "accept" | "decline") {
  fireEvent.press(screen.getByText(answer === "accept" ? copy.review.accept : copy.review.decline));
  const strings = answer === "accept" ? copy.review.confirmAccept : copy.review.confirmDecline;
  await screen.findByText(strings.title);
  return strings;
}

describe("entry", () => {
  it("reads the board and selects the trade by id, since there is no GET /trades/:id", async () => {
    await open();

    expect(mockApi.trades).toHaveBeenCalledTimes(1);
    expect(screen.getByText(fill(copy.review.from, { username: "sender" }))).toBeOnTheScreen();
  });

  it("says not-found when the board comes back without this trade on it", async () => {
    mockApi.trades.mockResolvedValue([trade({ id: "some-other-trade" })]);

    render(<TradeReview />);

    expect(await screen.findByText(copy.review.notFound.title)).toBeOnTheScreen();
  });

  it("renders the server's own sentence when the board could not be read", async () => {
    mockApi.trades.mockRejectedValue(new ApiError(500, SERVER_SENTENCE));

    render(<TradeReview />);

    expect(await screen.findByText(copy.review.loadError.title)).toBeOnTheScreen();
    expect(screen.getByText(SERVER_SENTENCE)).toBeOnTheScreen();
  });

  it("replaces a bare fetch diagnostic with copy, since it is not a sentence for a human", async () => {
    mockApi.trades.mockRejectedValue(new Error("Network request failed"));

    render(<TradeReview />);

    expect(await screen.findByText(copy.review.loadError.body)).toBeOnTheScreen();
    expect(screen.queryByText("Network request failed")).toBeNull();
  });

  it("draws the trade even when the ownership join never answers", async () => {
    // The collection is an annotation on a screen someone opened for the trade.
    mockApi.cards.mockRejectedValue(new Error("Network request failed"));

    await open();

    expect(screen.getByText(copy.review.accept)).toBeOnTheScreen();
  });
});

describe("the inversion, on the screen built around it", () => {
  it("gives the requested card and gets the offered one on an incoming trade", async () => {
    await open({ direction: "received" });

    expect(within(screen.getByTestId(GIVE_TEST_ID)).getByText(REQUESTED_NAME)).toBeOnTheScreen();
    expect(within(screen.getByTestId(GET_TEST_ID)).getByText(OFFERED_NAME)).toBeOnTheScreen();
  });

  it("inverts it for a sent trade reached read-only", async () => {
    await open({ direction: "sent" });

    expect(within(screen.getByTestId(GIVE_TEST_ID)).getByText(OFFERED_NAME)).toBeOnTheScreen();
    expect(within(screen.getByTestId(GET_TEST_ID)).getByText(REQUESTED_NAME)).toBeOnTheScreen();
  });

  it("names the two cards the same way round in the accept confirmation", async () => {
    await open({ direction: "received" });

    const strings = await confirm("accept");

    // The sentence and the thumbnails above it have to agree, which is the
    // reason `giveAndGet` is called once and read twice rather than re-derived.
    expect(
      screen.getByText(fill(strings.body, { give: REQUESTED_NAME, get: OFFERED_NAME }))
    ).toBeOnTheScreen();
  });

  it("names them the same way round again in the accepted outcome", async () => {
    const t = await open({ direction: "received" });
    mockApi.acceptTrade.mockResolvedValue({ ...t, status: "ACCEPTED", fulfillable: null });

    const strings = await confirm("accept");
    fireEvent.press(screen.getByText(strings.confirm));

    expect(await screen.findByText(copy.review.accepted)).toBeOnTheScreen();
    expect(
      screen.getByText(
        fill(copy.review.acceptedBody, { give: REQUESTED_NAME, get: OFFERED_NAME })
      )
    ).toBeOnTheScreen();
  });
});

describe("what can be answered", () => {
  it("offers both answers on a pending incoming trade", async () => {
    await open({ direction: "received", status: "PENDING", fulfillable: true });

    expect(screen.getByText(copy.review.accept)).not.toBeDisabled();
    expect(screen.getByText(copy.review.decline)).not.toBeDisabled();
  });

  it("disables accept but keeps decline live when fulfillable is exactly false", async () => {
    // Refusing to draw decline would strand the trade on the board forever:
    // the sender cannot withdraw it, so answering is the only thing that ends
    // it, and decline never re-checks ownership.
    await open({ direction: "received", status: "PENDING", fulfillable: false });

    expect(screen.getByText(copy.review.accept)).toBeDisabled();
    expect(screen.getByText(copy.review.decline)).not.toBeDisabled();
    expect(screen.getByText(copy.review.unfulfillable)).toBeOnTheScreen();
  });

  it("names the viewer's side when their own collection says the card is gone", async () => {
    mockApi.cards.mockResolvedValue([
      // `received`, so the card the viewer gives is the requested one.
      ownedCard("card-requested", REQUESTED_NAME, 0),
      ownedCard("card-offered", OFFERED_NAME, 0),
    ]);

    await open({ direction: "received", status: "PENDING", fulfillable: false });

    expect(await screen.findByText(copy.review.unfulfillableYou)).toBeOnTheScreen();
  });

  it("blames the other side when the viewer still holds what they would give", async () => {
    mockApi.cards.mockResolvedValue([
      ownedCard("card-requested", REQUESTED_NAME, 1),
      ownedCard("card-offered", OFFERED_NAME, 0),
    ]);

    await open({ direction: "received", status: "PENDING", fulfillable: false });

    expect(await screen.findByText(copy.review.unfulfillableThem)).toBeOnTheScreen();
  });

  it("offers no answer at all on a trade the viewer sent", async () => {
    await open({ direction: "sent", status: "PENDING" });

    expect(screen.queryByText(copy.review.accept)).toBeNull();
    expect(screen.queryByText(copy.review.decline)).toBeNull();
    // The board's own sentence, not a second copy of it.
    expect(screen.getByText(copy.board.status.sent[STATUS_KEY.PENDING])).toBeOnTheScreen();
    expect(screen.getByText(copy.board.sentInert)).toBeOnTheScreen();
  });

  it("offers no answer on an incoming trade somebody already answered", async () => {
    await open({ direction: "received", status: "ACCEPTED", fulfillable: null });

    expect(screen.queryByText(copy.review.accept)).toBeNull();
    expect(screen.getByText(copy.board.status.received[STATUS_KEY.ACCEPTED])).toBeOnTheScreen();
  });

  it("draws no can't-complete banner on an answered trade, where fulfillable is null", async () => {
    // Same `=== false` rule the board row keeps: `null` is "not applicable",
    // and a `!fulfillable` rewrite here would tell someone their completed
    // trade can no longer be completed.
    await open({ direction: "received", status: "ACCEPTED", fulfillable: null });

    expect(screen.queryByText(copy.review.unfulfillable)).toBeNull();
    expect(screen.queryByText(copy.review.unfulfillableYou)).toBeNull();
    expect(screen.queryByText(copy.review.unfulfillableThem)).toBeNull();
  });
});

describe("accept and decline lock together", () => {
  it("kills both buttons while one answer is in flight", async () => {
    const inFlight = deferred<Trade>();
    const t = await open();
    mockApi.acceptTrade.mockReturnValue(inFlight.promise);

    const strings = await confirm("accept");
    fireEvent.press(screen.getByText(strings.confirm));

    // The confirm button swapped its label for a spinner, which is how it says
    // it is busy; the cancel beside it must be dead too, or a cancel mid-flight
    // would drop the screen back to a review whose answer is already sent.
    await waitFor(() => expect(screen.queryByText(strings.confirm)).toBeNull());
    expect(screen.getByText(strings.cancel)).toBeDisabled();

    await act(async () => {
      inFlight.resolve({ ...t, status: "ACCEPTED", fulfillable: null });
    });
  });

  it("sends exactly one request however many times the button is pressed", async () => {
    const inFlight = deferred<Trade>();
    const t = await open();
    mockApi.acceptTrade.mockReturnValue(inFlight.promise);

    const strings = await confirm("accept");
    const button = screen.getByText(strings.confirm);
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);

    // Both endpoints claim with an `updateMany` on `status: "PENDING"`, so a
    // second answer that reached the server would come back 409 — an error
    // screen for something the user did exactly once.
    expect(mockApi.acceptTrade).toHaveBeenCalledTimes(1);

    await act(async () => {
      inFlight.resolve({ ...t, status: "ACCEPTED", fulfillable: null });
    });
  });

  it("locks the way out while the decline-instead recovery is in flight", async () => {
    // The one state where an action button is drawn beside another one and
    // `busy` is reachable: a refused accept that left the trade pending.
    const t = await open();
    mockApi.acceptTrade.mockRejectedValue(new ApiError(409, SERVER_SENTENCE));
    mockApi.trades.mockResolvedValue([t]);

    const strings = await confirm("accept");
    fireEvent.press(screen.getByText(strings.confirm));
    await screen.findByText(copy.review.failed.declineInstead);

    const inFlight = deferred<Trade>();
    mockApi.declineTrade.mockReturnValue(inFlight.promise);
    fireEvent.press(screen.getByText(copy.review.failed.declineInstead));

    await waitFor(() => expect(screen.getByText(copy.review.backToBoard)).toBeDisabled());

    await act(async () => {
      inFlight.resolve({ ...t, status: "DECLINED", fulfillable: null });
    });
  });
});

describe("classifying a refused answer", () => {
  /** Accept, with the board's answer on the failure re-read under the test's control. */
  async function refusedAccept(error: unknown, recheck: () => Promise<Trade[]>) {
    const t = await open();
    mockApi.acceptTrade.mockRejectedValue(error);
    mockApi.trades.mockImplementation(recheck);

    const strings = await confirm("accept");
    fireEvent.press(screen.getByText(strings.confirm));
    return t;
  }

  it("offers decline instead when the re-read finds the trade still pending", async () => {
    // An ownership 409 rolls the transaction back, so the offer survives and is
    // fully declinable — the one answer guaranteed to work, and the most
    // valuable thing on the screen.
    const t = trade();
    await refusedAccept(new ApiError(409, SERVER_SENTENCE), async () => [t]);

    expect(await screen.findByText(copy.review.failed.declineInstead)).toBeOnTheScreen();
    expect(screen.getByText(copy.review.failed.declineInsteadHint)).toBeOnTheScreen();
    // Retrying an accept whose ownership check just failed earns the same 409.
    expect(screen.queryByText(copy.review.failed.retry)).toBeNull();
  });

  it("does not read the server's wording to get there", async () => {
    // Same status, a sentence that says nothing. The classification comes from
    // the trade's state, which is the whole point — those 409 sentences are
    // rewritable copy and matching on them would break silently.
    const t = trade();
    await refusedAccept(new ApiError(409, "..."), async () => [t]);

    expect(await screen.findByText(copy.review.failed.declineInstead)).toBeOnTheScreen();
  });

  it("shows the outcome and suppresses retry when the re-read finds it answered", async () => {
    const answered = trade({ status: "DECLINED", fulfillable: null });
    await refusedAccept(new ApiError(409, SERVER_SENTENCE), async () => [answered]);

    // Rendered from the trade's real status, never from the answer attempted:
    // an accept that lost the race to a decline reads as declined.
    expect(await screen.findByText(copy.review.declined)).toBeOnTheScreen();
    expect(screen.queryByText(copy.review.failed.retry)).toBeNull();
    expect(screen.queryByText(copy.review.failed.declineInstead)).toBeNull();
    expect(screen.queryByText(copy.review.failed.title)).toBeNull();
  });

  it("reads a lost response as the success it was, not as a failure", async () => {
    // The request reached the server and the reply did not come back. The cards
    // have moved; telling this person it did not go through would be false.
    const accepted = trade({ status: "ACCEPTED", fulfillable: null });
    await refusedAccept(new Error("Network request failed"), async () => [accepted]);

    expect(await screen.findByText(copy.review.accepted)).toBeOnTheScreen();
  });

  it("falls back to the board when the re-read itself fails on a 409", async () => {
    // Nothing can tell the two 409s apart now, and the board is the only
    // recovery safe for both: decline on an answered trade is a second refusal
    // and so is a retry.
    await refusedAccept(new ApiError(409, SERVER_SENTENCE), async () => {
      throw new Error("Network request failed");
    });

    expect(await screen.findByText(copy.review.failed.title)).toBeOnTheScreen();
    expect(screen.getByText(copy.review.backToBoard)).toBeOnTheScreen();
    expect(screen.queryByText(copy.review.failed.retry)).toBeNull();
    expect(screen.queryByText(copy.review.failed.declineInstead)).toBeNull();
  });

  it("offers a retry for anything that is not a 409", async () => {
    const t = trade();
    await refusedAccept(new ApiError(500, SERVER_SENTENCE), async () => [t]);

    expect(await screen.findByText(copy.review.failed.retry)).toBeOnTheScreen();
    expect(screen.getByText(SERVER_SENTENCE)).toBeOnTheScreen();
    expect(screen.queryByText(copy.review.failed.declineInstead)).toBeNull();
  });

  it("offers a retry, not a decline, for a refused decline that left it pending", async () => {
    // Decline is a recovery for a refused accept only. Re-offering the button
    // that just failed under a different name would be a guaranteed second
    // refusal dressed up as a way out.
    const t = await open();
    mockApi.declineTrade.mockRejectedValue(new ApiError(409, SERVER_SENTENCE));
    mockApi.trades.mockResolvedValue([t]);

    const strings = await confirm("decline");
    fireEvent.press(screen.getByText(strings.confirm));

    expect(await screen.findByText(copy.review.failed.title)).toBeOnTheScreen();
    expect(screen.queryByText(copy.review.failed.declineInstead)).toBeNull();
  });

  it("re-reads the board exactly once, and only on the failure path", async () => {
    const t = trade();
    await refusedAccept(new ApiError(409, SERVER_SENTENCE), async () => [t]);
    await screen.findByText(copy.review.failed.declineInstead);

    // One for the entry load, one for the classification.
    expect(mockApi.trades).toHaveBeenCalledTimes(2);
  });
});

describe("leaving", () => {
  it("goes back when there is something to go back to", async () => {
    const t = await open();
    mockApi.declineTrade.mockResolvedValue({ ...t, status: "DECLINED", fulfillable: null });

    const strings = await confirm("decline");
    fireEvent.press(screen.getByText(strings.confirm));
    await screen.findByText(copy.review.declined);
    fireEvent.press(screen.getByText(copy.review.backToBoard));

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("replaces to the board when a deep link left nothing beneath it", async () => {
    // `back()` is a no-op on an empty history, which would leave the only way
    // off this screen dead.
    router.canGoBack.mockReturnValue(false);
    await open({ direction: "sent" });

    fireEvent.press(screen.getByText(copy.review.backToBoard));

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/(tabs)/cards");
  });

  it("says not-found rather than fetching when the route carries no id", async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({});

    render(<TradeReview />);

    expect(await screen.findByText(copy.review.notFound.title)).toBeOnTheScreen();
    expect(mockApi.trades).not.toHaveBeenCalled();
  });
});
