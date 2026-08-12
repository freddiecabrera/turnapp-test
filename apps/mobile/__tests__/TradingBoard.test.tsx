import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Cards from "../app/(tabs)/cards";
import { ApiError, api } from "../src/api";
import { TradingBoard } from "../src/components/TradingBoard";
import { copy, fill } from "../src/copy";
import type { Trade } from "../src/types";
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

const mockApi = jest.mocked(api);

/**
 * TH-10's board, and the pill it lives behind.
 *
 * The grouping is the point. The board sorts trades by what the viewer can do
 * about them — `needs you`, `waiting`, `history` — which is what replaced the
 * all/incoming/outgoing filter, and the rule that keeps it honest is that
 * `needs you` holds exactly the rows that can be accepted. A row that is listed
 * as needing an answer and then does nothing when tapped is worse than either
 * the filter or the badge this layout removed. The converse is not a rule:
 * `waiting` holds the incoming offers that can no longer complete, and those
 * still open, because declining them is the only way they ever leave the board.
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
async function board(trades: Trade[]) {
  mockApi.trades.mockResolvedValue(trades);
  render(<TradingBoard />);
  await waitFor(() => expect(mockApi.trades).toHaveBeenCalled());
}

/** The header a section draws for `count` rows under it. */
const header = (section: keyof typeof copy.board.sections, count: number) =>
  fill(copy.board.sections[section], { count });

describe("the empty board", () => {
  it("offers the way into a new trade to somebody who has never traded", async () => {
    await board([]);

    expect(await screen.findByText(copy.board.emptyNever.title)).toBeOnTheScreen();
    expect(screen.getByText(copy.board.emptyNever.body)).toBeOnTheScreen();

    fireEvent.press(screen.getByText(copy.board.emptyNever.action));
    expect(router.push).toHaveBeenCalledWith("/trade/new");
  });

  it("draws no section headers when there is nothing to put under them", async () => {
    await board([]);
    await screen.findByText(copy.board.emptyNever.title);

    // The full-width button is this state's whole point, so the floating one
    // would be a second control for one journey.
    expect(screen.queryByLabelText(copy.board.startTrade)).toBeNull();
    expect(screen.queryByText(header("needsYou", 0))).toBeNull();
  });
});

describe("grouping by what the viewer can do", () => {
  it("counts each section and leaves the empty ones undrawn", async () => {
    await board([
      // Answerable: incoming, pending, still fulfillable.
      trade({ id: "a", direction: "received", status: "PENDING" }),
      trade({ id: "b", direction: "received", status: "PENDING" }),
      // Unanswered, but nothing the viewer can do — one is theirs to wait on,
      // the other can no longer complete.
      trade({ id: "c", direction: "sent", status: "PENDING" }),
      trade({ id: "d", direction: "received", status: "PENDING", fulfillable: false }),
      // Answered.
      trade({ id: "e", direction: "sent", status: "ACCEPTED", fulfillable: null }),
    ]);

    expect(await screen.findByText(header("needsYou", 2))).toBeOnTheScreen();
    expect(screen.getByText(header("waiting", 2))).toBeOnTheScreen();
    expect(screen.getByText(header("history", 1))).toBeOnTheScreen();
  });

  it("never puts an unanswerable trade under the header that promises an answer", async () => {
    // The replaced `incoming` filter could not tell these two apart: both are
    // trades sent to the viewer, and only one of them can be acted on.
    await board([
      trade({ id: "stuck", direction: "received", status: "PENDING", fulfillable: false }),
      trade({ id: "done", direction: "received", status: "DECLINED", fulfillable: null }),
    ]);

    expect(await screen.findByText(header("waiting", 1))).toBeOnTheScreen();
    expect(screen.getByText(header("history", 1))).toBeOnTheScreen();
    expect(screen.queryByText(header("needsYou", 1))).toBeNull();
  });

  it("shows no needs-you header when nothing is waiting on the viewer", async () => {
    await board([trade({ direction: "sent", status: "PENDING" })]);

    expect(await screen.findByText(header("waiting", 1))).toBeOnTheScreen();
    expect(screen.queryByText(header("needsYou", 1))).toBeNull();
  });
});

describe("the way into a new trade", () => {
  it("floats over a populated board and opens the wizard", async () => {
    await board([trade({ direction: "sent" })]);
    await screen.findByText(header("waiting", 1));

    // Reached by its accessibility label: the control is an icon, so that label
    // is the only name it has, and a test that found it any other way would
    // pass with it unreachable to a screen reader.
    fireEvent.press(screen.getByLabelText(copy.board.startTrade));

    expect(router.push).toHaveBeenCalledWith("/trade/new");
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
    const status = await screen.findByText(copy.board.status.received.pending);

    // Pressed through the row's own status chip rather than by role: the
    // floating way into a new trade is a button on this screen too, and a
    // lookup that assumed there was only one would break the day it appeared —
    // which is exactly what it did.
    fireEvent.press(status);

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
