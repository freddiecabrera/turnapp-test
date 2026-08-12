import { render, screen, within } from "@testing-library/react-native";
import { GET_TEST_ID, GIVE_TEST_ID, TradeCards, giveAndGet } from "../src/components/TradeCards";
import { copy } from "../src/copy";
import { OFFERED_NAME, REQUESTED_NAME, card } from "../test/trading";

// A host stub. The real one loads its font asynchronously and calls setState
// when that resolves, which lands outside `act` on every single render.
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

/**
 * The inversion, at the one component that owns it.
 *
 * `offeredCard` always belongs to `fromUser`, so a single stored row reads
 * backwards for the two parties and `direction` is the only thing that says
 * which side the viewer is on. Every trading surface in the app — the board
 * row, the approve/decline screen, the wizard's review step — draws its pair
 * through here, so getting it wrong here gets it wrong in three places at once
 * and getting it right anywhere else does not help.
 *
 * Both directions are asserted against **one** fixture. A suite that covers a
 * single direction proves nothing about an inversion: the assertion it makes is
 * equally true of an implementation that ignores `direction` entirely.
 */

const offered = card("card-offered", OFFERED_NAME);
const requested = card("card-requested", REQUESTED_NAME);

/** The name rendered in each of the two columns, addressed by testID. */
function columns(): { give: string; get: string } {
  return {
    give: within(screen.getByTestId(GIVE_TEST_ID)).getByText(/Original$/).props.children as string,
    get: within(screen.getByTestId(GET_TEST_ID)).getByText(/Original$/).props.children as string,
  };
}

describe("giveAndGet", () => {
  it("hands a sender the card they offered and the card they asked for", () => {
    expect(giveAndGet("sent", offered, requested)).toEqual({ give: offered, get: requested });
  });

  it("inverts both sides for the recipient", () => {
    expect(giveAndGet("received", offered, requested)).toEqual({ give: requested, get: offered });
  });
});

describe("TradeCards", () => {
  it("draws the offered card as what a sender gives and the requested as what they get", () => {
    render(<TradeCards direction="sent" offeredCard={offered} requestedCard={requested} />);

    expect(columns()).toEqual({ give: OFFERED_NAME, get: REQUESTED_NAME });
  });

  it("draws the same trade inverted for the recipient", () => {
    render(<TradeCards direction="received" offeredCard={offered} requestedCard={requested} />);

    // The exact opposite of the case above, on identical props. The two card
    // names are the only difference between a correct render and a backwards
    // one, and a user reading this screen has nothing else to check it against.
    expect(columns()).toEqual({ give: REQUESTED_NAME, get: OFFERED_NAME });
  });

  it("labels the columns from the viewer's side in both directions", () => {
    const { rerender } = render(
      <TradeCards direction="sent" offeredCard={offered} requestedCard={requested} />
    );
    expect(within(screen.getByTestId(GIVE_TEST_ID)).getByText(copy.trade.give)).toBeOnTheScreen();
    expect(within(screen.getByTestId(GET_TEST_ID)).getByText(copy.trade.get)).toBeOnTheScreen();

    // The labels do not move when the direction does — the cards under them do.
    rerender(<TradeCards direction="received" offeredCard={offered} requestedCard={requested} />);
    expect(within(screen.getByTestId(GIVE_TEST_ID)).getByText(copy.trade.give)).toBeOnTheScreen();
    expect(within(screen.getByTestId(GET_TEST_ID)).getByText(copy.trade.get)).toBeOnTheScreen();
  });

  it("falls back to the placeholder name rather than rendering an empty column", () => {
    render(
      <TradeCards
        direction="sent"
        offeredCard={card("card-offered", "")}
        requestedCard={requested}
      />
    );

    expect(
      within(screen.getByTestId(GIVE_TEST_ID)).getByText(copy.trade.unnamedCard)
    ).toBeOnTheScreen();
  });
});
