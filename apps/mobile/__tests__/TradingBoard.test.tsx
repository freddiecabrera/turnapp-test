import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Cards from "../app/(tabs)/cards";
import { ApiError, api } from "../src/api";
import { TradingBoard } from "../src/components/TradingBoard";
import { copy, fill } from "../src/copy";
import {
  focusEffectAsEffect,
  refocus,
  resetFocus,
  routerSpy,
  trade,
  type RouterSpy,
} from "../test/trading";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({}) };
});

jest.mock("expo-router", () => ({
  useRouter: jest.fn(),
  useFocusEffect: jest.fn(),
}));

jest.mock("../src/api", () => ({
  ...jest.requireActual("../src/api"),
  api: { trades: jest.fn(), cards: jest.fn() },
}));

const mockApi = api as jest.Mocked<Pick<typeof api, "trades" | "cards">>;

/**
 * TH-10's board, and the pill it lives behind.
 *
 * The two empty states are the point. They are different facts with different
 * exits — never traded at all, which offers the way into a new trade, versus
 * has trades but none matching the filter, which offers to clear the filter —
 * and collapsing them would tell somebody with a full board that they have no
 * trades yet.
 */

const SERVER_SENTENCE = "server said no";

let router: RouterSpy;

beforeEach(() => {
  // `resetAllMocks`, not `clearAllMocks`: the latter empties `mock.calls` but
  // leaves a `mockResolvedValueOnce` queue intact, so an unconsumed one-shot
  // answer becomes the *next* case's first response.
  jest.resetAllMocks();
  resetFocus();
  router = routerSpy();
  (useRouter as jest.Mock).mockReturnValue(router);
  (useFocusEffect as jest.Mock).mockImplementation(focusEffectAsEffect);
  mockApi.cards.mockResolvedValue([]);
});

/** Mount the board with this board state, and wait for the first load to land. */
async function board(trades: Parameters<typeof mockApi.trades.mockResolvedValue>[0]) {
  mockApi.trades.mockResolvedValue(trades);
  render(<TradingBoard />);
  await waitFor(() => expect(mockApi.trades).toHaveBeenCalled());
}

describe("empty never versus empty filtered", () => {
  it("offers the way into a new trade to somebody who has never traded", async () => {
    await board([]);

    expect(await screen.findByText(copy.board.emptyNever.title)).toBeOnTheScreen();
    expect(screen.getByText(copy.board.emptyNever.body)).toBeOnTheScreen();

    fireEvent.press(screen.getByText(copy.board.emptyNever.action));
    expect(router.push).toHaveBeenCalledWith("/trade/new");
  });

  it("blames the filter, not the board, when trades exist but none match", async () => {
    await board([trade({ direction: "sent" })]);
    await screen.findByText(copy.board.status.sent.pending);

    fireEvent.press(screen.getByText(copy.board.filters.incoming));

    // Telling this person "no trades yet" would be false — they have one.
    expect(await screen.findByText(copy.board.emptyFiltered.title)).toBeOnTheScreen();
    expect(screen.queryByText(copy.board.emptyNever.title)).toBeNull();
  });

  it("clears the filter rather than starting a trade from the filtered empty", async () => {
    await board([trade({ direction: "sent" })]);
    await screen.findByText(copy.board.status.sent.pending);
    fireEvent.press(screen.getByText(copy.board.filters.incoming));
    await screen.findByText(copy.board.emptyFiltered.title);

    fireEvent.press(screen.getByText(copy.board.emptyFiltered.action));

    // The row comes back, and nothing navigated.
    expect(await screen.findByText(copy.board.status.sent.pending)).toBeOnTheScreen();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("never shows the filtered empty to somebody with no trades at all", async () => {
    await board([]);
    await screen.findByText(copy.board.emptyNever.title);

    fireEvent.press(screen.getByText(copy.board.filters.outgoing));

    expect(await screen.findByText(copy.board.emptyNever.title)).toBeOnTheScreen();
    expect(screen.queryByText(copy.board.emptyFiltered.title)).toBeNull();
  });
});

describe("filtering", () => {
  it("keeps only what the pill names", async () => {
    await board([trade({ id: "in", direction: "received" }), trade({ id: "out", direction: "sent" })]);
    await screen.findByText(copy.board.status.received.pending);

    fireEvent.press(screen.getByText(copy.board.filters.outgoing));

    // `incoming`/`outgoing` are the viewer's words for the API's
    // `received`/`sent`, and the mapping is the one thing this can get wrong.
    expect(await screen.findByText(copy.board.status.sent.pending)).toBeOnTheScreen();
    expect(screen.queryByText(copy.board.status.received.pending)).toBeNull();
  });

  it("counts pending incoming trades and nothing else", async () => {
    await board([
      trade({ id: "a", direction: "received", status: "PENDING" }),
      trade({ id: "b", direction: "received", status: "PENDING" }),
      // Answered, so it is not waiting on anybody.
      trade({ id: "c", direction: "received", status: "ACCEPTED", fulfillable: null }),
      // Outgoing, so it is waiting on the other person.
      trade({ id: "d", direction: "sent", status: "PENDING" }),
    ]);

    expect(
      await screen.findByText(fill(copy.board.pendingCount, { count: 2 }))
    ).toBeOnTheScreen();
  });

  it("hides the count when nothing is waiting", async () => {
    await board([trade({ direction: "sent", status: "PENDING" })]);
    await screen.findByText(copy.board.status.sent.pending);

    expect(screen.queryByText(fill(copy.board.pendingCount, { count: 0 }))).toBeNull();
  });
});

describe("failures", () => {
  it("renders the server's own sentence and still offers the way into a trade", async () => {
    mockApi.trades.mockRejectedValue(new ApiError(500, SERVER_SENTENCE));
    render(<TradingBoard />);

    expect(await screen.findByText(copy.board.error.title)).toBeOnTheScreen();
    expect(screen.getByText(SERVER_SENTENCE)).toBeOnTheScreen();

    // The entry point has to work from every state, including this one.
    fireEvent.press(screen.getByText(copy.board.error.action));
    expect(router.push).toHaveBeenCalledWith("/trade/new");
  });

  it("replaces a bare fetch diagnostic with copy", async () => {
    mockApi.trades.mockRejectedValue(new Error("Network request failed"));
    render(<TradingBoard />);

    expect(await screen.findByText(copy.board.error.body)).toBeOnTheScreen();
    expect(screen.queryByText("Network request failed")).toBeNull();
  });

  it("keeps the rows and says they are stale when a refresh fails over them", async () => {
    await board([trade({ direction: "sent" })]);
    await screen.findByText(copy.board.status.sent.pending);

    // A returning focus, which is how this state is actually reached.
    mockApi.trades.mockRejectedValue(new Error("Network request failed"));
    await refocus();

    // Distinct from a first load that failed: there are rows to fall back on,
    // so they stay and the banner says only that they are old.
    expect(screen.getByText(copy.board.refreshFailed)).toBeOnTheScreen();
    expect(screen.getByText(copy.board.status.sent.pending)).toBeOnTheScreen();
    expect(screen.queryByText(copy.board.error.title)).toBeNull();
  });

  it("clears the stale banner once a refresh lands", async () => {
    await board([trade({ direction: "sent" })]);
    await screen.findByText(copy.board.status.sent.pending);
    mockApi.trades.mockRejectedValue(new Error("Network request failed"));
    await refocus();
    expect(screen.getByText(copy.board.refreshFailed)).toBeOnTheScreen();

    mockApi.trades.mockResolvedValue([trade({ direction: "sent" })]);
    await refocus();

    expect(screen.queryByText(copy.board.refreshFailed)).toBeNull();
  });
});

describe("opening a row", () => {
  it("routes to the trade behind an actionable row", async () => {
    await board([trade({ id: "trade-9", direction: "received", status: "PENDING" })]);
    await screen.findByText(copy.board.status.received.pending);

    fireEvent.press(screen.getByRole("button"));

    expect(router.push).toHaveBeenCalledWith("/trade/trade-9");
  });
});

describe("the collectibles pill the board lives behind", () => {
  it("asks for no trades until the trading pill is pressed", async () => {
    render(<Cards />);
    await waitFor(() => expect(mockApi.cards).toHaveBeenCalled());

    // Mounting the board on the collection tab would put `GET /trades` on every
    // visit for someone who never opens it.
    expect(mockApi.trades).not.toHaveBeenCalled();
  });

  it("mounts the board behind the pill", async () => {
    mockApi.trades.mockResolvedValue([]);
    render(<Cards />);

    fireEvent.press(screen.getByTestId("collectibles-tab-trading-board"));

    expect(await screen.findByText(copy.board.emptyNever.title)).toBeOnTheScreen();
    expect(mockApi.trades).toHaveBeenCalled();
  });
});
