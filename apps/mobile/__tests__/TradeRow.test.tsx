import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { GET_TEST_ID, GIVE_TEST_ID } from "../src/components/TradeCards";
import { STATUS_KEY, TradeRow, isActionable } from "../src/components/TradeRow";
import { copy } from "../src/copy";
import type { Trade, TradeStatus } from "../src/types";
import { OFFERED_NAME, REQUESTED_NAME, trade } from "../test/trading";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

/**
 * The board row, across every combination the API can hand it.
 *
 * `status` × `direction` × `fulfillable` is eight rows, and they differ in what
 * they say and in whether they lead anywhere. Exactly one is actionable, and
 * the two rules that decide it are the ones a reasonable-looking rewrite
 * breaks: a `sent` row is inert in every status because there is no cancel
 * endpoint to reach, and `fulfillable` is tested against `false` and never
 * against falsiness because `null` means "not applicable".
 */

/** Renders a row and reports whether it offers anything to press. */
function renderRow(overrides: Partial<Trade>) {
  const onPress = jest.fn();
  render(<TradeRow trade={trade(overrides)} onPress={onPress} />);
  return onPress;
}

describe("the eight board rows", () => {
  // Every combination `GET /trades` can produce. `fulfillable` is only
  // meaningful on a PENDING row — the serializer forces `null` the moment a
  // trade is answered — so the answered rows carry `null` here because that is
  // what actually arrives, not because the field is unset.
  const rows: {
    name: string;
    trade: Partial<Trade>;
    actionable: boolean;
  }[] = [
    {
      name: "received · pending · fulfillable — the only row that leads anywhere",
      trade: { direction: "received", status: "PENDING", fulfillable: true },
      actionable: true,
    },
    {
      name: "received · pending · unfulfillable",
      trade: { direction: "received", status: "PENDING", fulfillable: false },
      actionable: false,
    },
    {
      name: "received · accepted",
      trade: { direction: "received", status: "ACCEPTED", fulfillable: null },
      actionable: false,
    },
    {
      name: "received · declined",
      trade: { direction: "received", status: "DECLINED", fulfillable: null },
      actionable: false,
    },
    {
      name: "sent · pending · fulfillable",
      trade: { direction: "sent", status: "PENDING", fulfillable: true },
      actionable: false,
    },
    {
      name: "sent · pending · unfulfillable",
      trade: { direction: "sent", status: "PENDING", fulfillable: false },
      actionable: false,
    },
    {
      name: "sent · accepted",
      trade: { direction: "sent", status: "ACCEPTED", fulfillable: null },
      actionable: false,
    },
    {
      name: "sent · declined",
      trade: { direction: "sent", status: "DECLINED", fulfillable: null },
      actionable: false,
    },
  ];

  it.each(rows)("$name", ({ trade: overrides, actionable }) => {
    const onPress = renderRow(overrides);

    // The status line is picked by direction AND status: one row means opposite
    // things to the two parties, so eight rows draw eight sentences and reading
    // through `copy` is what keeps this honest when they are rewritten.
    const direction = overrides.direction!;
    const status = overrides.status as TradeStatus;
    expect(screen.getByText(copy.board.status[direction][STATUS_KEY[status]])).toBeOnTheScreen();

    // An inert row is a plain `View`, not a disabled `Pressable`: there is
    // nothing to press, and a pressable that swallows the touch is the dead
    // affordance the row is drawn this way to avoid.
    const pressable = screen.queryByRole("button");
    expect(pressable === null).toBe(!actionable);
    if (pressable) fireEvent.press(pressable);
    expect(onPress).toHaveBeenCalledTimes(actionable ? 1 : 0);

    expect(isActionable(trade(overrides))).toBe(actionable);
  });

  it("gives the eight rows eight distinct status sentences to draw from", () => {
    // The row picks its sentence by `[direction][status]`, so two directions
    // sharing one string would make a swapped lookup invisible to every case
    // above. This asserts the copy still distinguishes them, whatever it says.
    const sentences = (["sent", "received"] as const).flatMap((direction) =>
      Object.values(STATUS_KEY).map((key) => copy.board.status[direction][key])
    );

    expect(new Set(sentences).size).toBe(6);
  });
});

describe("a sent row is inert in every status", () => {
  it.each(["PENDING", "ACCEPTED", "DECLINED"] as const)(
    "offers nothing to press on a %s outgoing offer",
    (status) => {
      // There is no cancel or withdraw endpoint anywhere in the API, and
      // `POST /trades/:id/decline` 403s anyone but the recipient — so a sender
      // has no move at all and the row must not suggest one.
      const onPress = renderRow({ direction: "sent", status, fulfillable: null });

      expect(screen.queryByRole("button")).toBeNull();
      expect(onPress).not.toHaveBeenCalled();
    }
  );
});

describe("fulfillable is false, never merely falsy", () => {
  it("draws the can't-complete note when the API says exactly false", () => {
    renderRow({ status: "PENDING", fulfillable: false });

    expect(screen.getByText(copy.board.unfulfillable)).toBeOnTheScreen();
  });

  // The point of this pair. `null` means "not applicable" and the serializer
  // forces it for every answered trade, so a rewrite to `!trade.fulfillable`
  // would paint the can't-complete treatment over every finished trade on the
  // board — a row that reads as broken when it in fact completed.
  it.each(["ACCEPTED", "DECLINED"] as const)(
    "leaves a %s trade alone, where fulfillable is null rather than false",
    (status) => {
      renderRow({ status, fulfillable: null });

      expect(screen.queryByText(copy.board.unfulfillable)).toBeNull();
    }
  );

  it("keeps a pending row actionable when fulfillable is null", () => {
    // `GET /trades` does not produce this, but leaving the row actionable is
    // the safe side of the same `!== false` test: accept re-verifies ownership
    // atomically and refuses on its own terms. A `!fulfillable` rewrite would
    // silently make this row dead instead.
    const onPress = renderRow({ direction: "received", status: "PENDING", fulfillable: null });

    fireEvent.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("the row's cards and partner", () => {
  it("names the recipient on an outgoing row and the sender on an incoming one", () => {
    renderRow({ direction: "sent" });
    expect(screen.getByText("@recipient")).toBeOnTheScreen();

    screen.unmount();

    renderRow({ direction: "received" });
    expect(screen.getByText("@sender")).toBeOnTheScreen();
  });

  it("passes the viewer's direction through to the card pair", () => {
    // The row does not re-derive the inversion, and this is what proves it did
    // not stop passing `direction` down — a row that hardcoded "sent" would
    // draw every incoming trade backwards while every other assertion here
    // still held.
    renderRow({ direction: "received" });

    expect(within(screen.getByTestId(GIVE_TEST_ID)).getByText(REQUESTED_NAME)).toBeOnTheScreen();
    expect(within(screen.getByTestId(GET_TEST_ID)).getByText(OFFERED_NAME)).toBeOnTheScreen();
  });
});
