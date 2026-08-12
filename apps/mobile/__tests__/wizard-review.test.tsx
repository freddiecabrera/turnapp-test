import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Redirect, useRouter } from "expo-router";
import ReviewOffer from "../app/trade/new/review";
import { ApiError, api } from "../src/api";
import { GET_TEST_ID, GIVE_TEST_ID } from "../src/components/TradeCards";
import { copy, fill } from "../src/copy";
import { chooseOffered, choosePartner, chooseRequested, resetDraft } from "../src/wizard";
import {
  OFFERED_NAME,
  REQUESTED_NAME,
  deferred,
  ownedCard,
  partnerCard,
  routerSpy,
  trade,
  userSummary,
  type RouterSpy,
} from "../test/trading";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({}) };
});

jest.mock("expo-router", () => ({
  useRouter: jest.fn(),
  Redirect: jest.fn(() => null),
}));

jest.mock("../src/api", () => ({
  ...jest.requireActual("../src/api"),
  api: { createTrade: jest.fn() },
}));

const mockApi = jest.mocked(api);

/**
 * TH-11, step 4 — the only screen in the wizard that writes anything.
 *
 * `POST /trades` documents thirteen refusals and they collapse into three
 * recoveries, because a person needs to know whether to change something, go
 * look at something, or stop. The branch switches on `status` and never on the
 * message: those sentences belong to the server and are meant to be rewritten,
 * so every rejection here carries an obvious fixture string instead of a real
 * one.
 */

const SERVER_SENTENCE = "server said no";

const PARTNER = userSummary("partner-1", "partner", 77);

let router: RouterSpy;

beforeEach(() => {
  jest.resetAllMocks();
  resetDraft();
  router = routerSpy();
  (useRouter as jest.Mock).mockReturnValue(router);
  (Redirect as unknown as jest.Mock).mockImplementation(() => null);

  choosePartner(PARTNER);
  chooseOffered(ownedCard("card-offered", OFFERED_NAME, 1));
  chooseRequested(partnerCard("card-requested", REQUESTED_NAME));
});

/** Press send, having armed `POST /trades` with this answer. */
function send() {
  fireEvent.press(screen.getByText(copy.wizard.review.confirm));
}

describe("the offer being composed", () => {
  it("draws the sender's own side of it", () => {
    render(<ReviewOffer />);

    // A trade being composed by its sender is `direction: "sent"` — the card
    // chosen in step 2 is the one going away.
    expect(within(screen.getByTestId(GIVE_TEST_ID)).getByText(OFFERED_NAME)).toBeOnTheScreen();
    expect(within(screen.getByTestId(GET_TEST_ID)).getByText(REQUESTED_NAME)).toBeOnTheScreen();
    expect(
      screen.getByText(fill(copy.wizard.review.to, { username: PARTNER.username }))
    ).toBeOnTheScreen();
  });

  it("sends the three ids the draft holds", async () => {
    mockApi.createTrade.mockResolvedValue(trade({ direction: "sent" }));
    render(<ReviewOffer />);

    send();

    expect(mockApi.createTrade).toHaveBeenCalledWith(
      PARTNER.id,
      "card-offered",
      "card-requested"
    );
    await screen.findByText(copy.wizard.review.success);
  });

  it("redirects to step 1 when the draft is incomplete", () => {
    resetDraft();

    render(<ReviewOffer />);

    expect((Redirect as unknown as jest.Mock).mock.calls[0][0]).toMatchObject({
      href: "/trade/new",
    });
    expect(mockApi.createTrade).not.toHaveBeenCalled();
  });

  it("locks the cancel button while the offer is being sent", async () => {
    const inFlight = deferred<ReturnType<typeof trade>>();
    mockApi.createTrade.mockReturnValue(inFlight.promise);
    render(<ReviewOffer />);

    send();

    // The confirm swaps its label for a spinner; cancel must not stay live and
    // tear the wizard down over a request that is already on the wire.
    await waitFor(() => expect(screen.queryByText(copy.wizard.review.confirm)).toBeNull());
    expect(screen.getByText(copy.wizard.review.cancel)).toBeDisabled();

    inFlight.resolve(trade({ direction: "sent" }));
    await screen.findByText(copy.wizard.review.success);
  });
});

describe("the confirmation", () => {
  it("renders the trade the server created, not the draft", async () => {
    // `POST /trades` answers 201 with the whole `Trade`, so the confirmation is
    // the row that exists rather than the one that was composed.
    mockApi.createTrade.mockResolvedValue(
      trade({
        direction: "sent",
        offeredCard: { ...trade().offeredCard, name: "As Stored" },
      })
    );
    render(<ReviewOffer />);

    send();

    expect(await screen.findByText(copy.wizard.review.success)).toBeOnTheScreen();
    expect(within(screen.getByTestId(GIVE_TEST_ID)).getByText("As Stored")).toBeOnTheScreen();
  });

  it("is the one state with no way back", async () => {
    mockApi.createTrade.mockResolvedValue(trade({ direction: "sent" }));
    render(<ReviewOffer />);
    send();
    await screen.findByText(copy.wizard.review.success);

    // Back would land on a card picker whose work is done, and re-sending only
    // earns the 409 for an offer that already exists.
    expect(screen.queryByLabelText(copy.wizard.back)).toBeNull();

    fireEvent.press(screen.getByText(copy.wizard.review.successAction));
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
  });
});

describe("thirteen refusals, three recoveries", () => {
  async function failWith(error: unknown) {
    mockApi.createTrade.mockRejectedValue(error);
    render(<ReviewOffer />);
    send();
    await screen.findByText(copy.wizard.review.error.title);
  }

  it("points a 409 at the board, since that offer already exists", async () => {
    await failWith(new ApiError(409, SERVER_SENTENCE));

    expect(screen.getByText(SERVER_SENTENCE)).toBeOnTheScreen();
    expect(screen.queryByText(copy.wizard.review.error.retry)).toBeNull();
    expect(screen.queryByText(copy.wizard.review.error.changeOffer)).toBeNull();

    fireEvent.press(screen.getByText(copy.wizard.review.error.board));
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
  });

  it.each([400, 404])(
    "offers all three re-picks for a %s, where something chosen stopped being true",
    async (status) => {
      await failWith(new ApiError(status, SERVER_SENTENCE));

      // The server's own sentence sits above them and says which to press.
      expect(screen.getByText(SERVER_SENTENCE)).toBeOnTheScreen();
      expect(screen.getByText(copy.wizard.review.error.changeRequest)).toBeOnTheScreen();
      expect(screen.getByText(copy.wizard.review.error.changeOffer)).toBeOnTheScreen();
      expect(screen.getByText(copy.wizard.review.error.changePartner)).toBeOnTheScreen();
      expect(screen.queryByText(copy.wizard.review.error.retry)).toBeNull();
    }
  );

  it("routes each re-pick at the step that owns what it changes", async () => {
    await failWith(new ApiError(400, SERVER_SENTENCE));

    fireEvent.press(screen.getByText(copy.wizard.review.error.changeRequest));
    // Step 3 is the screen directly beneath this one.
    expect(router.back).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText(copy.wizard.review.error.changeOffer));
    expect(router.dismissTo).toHaveBeenCalledWith("/trade/new/offer");

    fireEvent.press(screen.getByText(copy.wizard.review.error.changePartner));
    expect(router.dismissTo).toHaveBeenCalledWith("/trade/new");
  });

  it("offers a retry for a 500, where nothing the wizard holds is wrong", async () => {
    await failWith(new ApiError(500, SERVER_SENTENCE));

    expect(screen.getByText(copy.wizard.review.error.retry)).toBeOnTheScreen();
    expect(screen.queryByText(copy.wizard.review.error.changeOffer)).toBeNull();
    expect(screen.queryByText(copy.wizard.review.error.board)).toBeNull();
  });

  it("retries the same request unchanged", async () => {
    await failWith(new ApiError(500, SERVER_SENTENCE));
    mockApi.createTrade.mockResolvedValue(trade({ direction: "sent" }));

    fireEvent.press(screen.getByText(copy.wizard.review.error.retry));

    expect(await screen.findByText(copy.wizard.review.success)).toBeOnTheScreen();
    expect(mockApi.createTrade).toHaveBeenNthCalledWith(
      2,
      PARTNER.id,
      "card-offered",
      "card-requested"
    );
  });

  it("replaces a bare fetch diagnostic with copy and still offers the retry", async () => {
    await failWith(new Error("Network request failed"));

    expect(screen.getByText(copy.wizard.review.error.body)).toBeOnTheScreen();
    expect(screen.queryByText("Network request failed")).toBeNull();
    expect(screen.getByText(copy.wizard.review.error.retry)).toBeOnTheScreen();
  });
});
