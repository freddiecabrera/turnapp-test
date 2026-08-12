import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import ChooseOffer from "../app/trade/new/offer";
import ChooseRequest from "../app/trade/new/request";
import { ApiError, api } from "../src/api";
import { copy, fill } from "../src/copy";
import { chooseOffered, choosePartner, resetDraft } from "../src/wizard";
import {
  flush,
  focusEffectAsEffect,
  ownedCard,
  partnerCard,
  refocus,
  resetFocus,
  routerSpy,
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
  useFocusEffect: jest.fn(),
  Redirect: jest.fn(() => null),
}));

jest.mock("../src/api", () => ({
  ...jest.requireActual("../src/api"),
  api: { cards: jest.fn(), userCards: jest.fn() },
}));

const mockApi = jest.mocked(api);

/**
 * TH-11's three dead ends, which are three different exits.
 *
 * You own nothing is a hard stop — no earlier step changes it, so the only
 * thing that helps is scanning. They own nothing is a dead end for *this
 * partner*, so the way out is a different person and the card already chosen
 * stays chosen. And a partner whose only card is the one being offered is the
 * suppression's own doing: that one routes back to **step 2**, not out of the
 * wizard, because sending this person away would be sending them away from a
 * trade that works.
 */

const SERVER_SENTENCE = "server said no";

const PARTNER = userSummary("partner-1", "partner", 77);
const MY_CARD = ownedCard("card-mine", "Mine", 1);
const THEIR_CARD = partnerCard("card-theirs", "Theirs");

let router: RouterSpy;

beforeEach(() => {
  jest.resetAllMocks();
  resetFocus();
  resetDraft();
  router = routerSpy();
  (useRouter as jest.Mock).mockReturnValue(router);
  (useFocusEffect as jest.Mock).mockImplementation(focusEffectAsEffect);
  (Redirect as unknown as jest.Mock).mockImplementation(() => null);
});

/** Step 3 needs both earlier answers; without them the screen only redirects. */
function draftThrough(offered = MY_CARD) {
  choosePartner(PARTNER);
  chooseOffered(offered);
}

/**
 * The pickable cards in step 3's grid.
 *
 * `PartnerCardTile` is the only thing on that screen with a button role apart
 * from the frame's own back chevron, which every step draws and which is
 * identified by its accessibility label rather than by counting on it being
 * first.
 */
function grid() {
  return screen
    .queryAllByRole("button")
    .filter((node) => node.props.accessibilityLabel !== copy.wizard.back);
}

describe("step 2 — you own nothing", () => {
  it("points at scanning, the only thing that fixes it", async () => {
    draftThrough();
    // `owned` comes from the server, so an account that owns nothing produces
    // an empty filter rather than a failed request.
    mockApi.cards.mockResolvedValue([ownedCard("card-locked", "Locked", 0)]);

    render(<ChooseOffer />);

    expect(await screen.findByText(copy.wizard.offer.empty)).toBeOnTheScreen();
    fireEvent.press(screen.getByText(copy.wizard.offer.emptyAction));

    // `navigate`, not `push`: the tabs are already under this stack, so a push
    // would stack a second copy of the tab navigator on top of the wizard.
    expect(router.navigate).toHaveBeenCalledWith("/(tabs)/scan");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("offers no way forward from it", async () => {
    draftThrough();
    mockApi.cards.mockResolvedValue([]);

    render(<ChooseOffer />);
    await screen.findByText(copy.wizard.offer.empty);

    // A disabled Continue under a dead end is an affordance for a step that
    // cannot be reached from here.
    expect(screen.queryByText(copy.wizard.continue)).toBeNull();
  });

  it("keeps a failed load distinct from owning nothing", async () => {
    draftThrough();
    mockApi.cards.mockRejectedValue(new ApiError(500, SERVER_SENTENCE));

    render(<ChooseOffer />);

    expect(await screen.findByText(copy.wizard.offer.errorTitle)).toBeOnTheScreen();
    expect(screen.getByText(SERVER_SENTENCE)).toBeOnTheScreen();
    expect(screen.queryByText(copy.wizard.offer.empty)).toBeNull();
    expect(screen.queryByText(copy.wizard.continue)).toBeNull();
  });

  it("sends a wizard opened without a partner back to step 1", async () => {
    // Deep-linked, or opened after the draft was lost. Step 1 is the only place
    // that can supply a partner.
    mockApi.cards.mockResolvedValue([]);

    render(<ChooseOffer />);

    expect((Redirect as unknown as jest.Mock).mock.calls[0][0]).toMatchObject({
      href: "/trade/new",
    });

    // The load lives in a hook, so it cannot be skipped ahead of the redirect:
    // this screen fetches the collection it is about to navigate away from.
    // One wasted request that nothing renders from — recorded because it is
    // what the code does, not because it needs changing.
    await flush();
    expect(mockApi.cards).toHaveBeenCalledTimes(1);
  });
});

describe("step 3 — they own nothing", () => {
  it("sends the viewer back for a different partner, not out of the wizard", async () => {
    draftThrough();
    mockApi.userCards.mockResolvedValue([]);
    mockApi.cards.mockResolvedValue([MY_CARD]);

    render(<ChooseRequest />);

    expect(await screen.findByText(copy.wizard.request.empty)).toBeOnTheScreen();
    fireEvent.press(screen.getByText(copy.wizard.request.emptyAction));

    // `dismissTo` rather than a walk back: step 1 keeps its query and its
    // results, and the card chosen in step 2 stays chosen, which is what the
    // copy promises.
    expect(router.dismissTo).toHaveBeenCalledWith("/trade/new");
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe("step 3 — their only card is the one being offered", () => {
  /** The partner holds exactly one card, and it is the one already on the table. */
  async function onlyOffered() {
    const shared = ownedCard("card-shared", "Shared", 1);
    draftThrough(shared);
    mockApi.userCards.mockResolvedValue([partnerCard("card-shared", "Shared")]);
    mockApi.cards.mockResolvedValue([shared]);

    render(<ChooseRequest />);
    await screen.findByText(copy.wizard.request.onlyOffered.title);
  }

  it("is a different dead end from a partner who owns nothing", async () => {
    await onlyOffered();

    // This person does have a card. Telling them to find somebody else would
    // send them away from a trade that works.
    expect(screen.queryByText(copy.wizard.request.empty)).toBeNull();
  });

  it("routes back to step 2, because the offer is what has to change", async () => {
    await onlyOffered();

    fireEvent.press(screen.getByText(copy.wizard.request.onlyOffered.action));

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it("still offers a different partner as the second way out", async () => {
    await onlyOffered();

    fireEvent.press(screen.getByText(copy.wizard.request.emptyAction));

    expect(router.dismissTo).toHaveBeenCalledWith("/trade/new");
  });

  it("suppresses the offered card rather than letting it be picked on both sides", async () => {
    const shared = ownedCard("card-shared", "Shared", 1);
    draftThrough(shared);
    mockApi.userCards.mockResolvedValue([
      partnerCard("card-shared", "Shared"),
      partnerCard("card-other", "Other"),
    ]);
    mockApi.cards.mockResolvedValue([shared]);

    render(<ChooseRequest />);
    await waitFor(() => expect(mockApi.userCards).toHaveBeenCalled());

    // Two cards came back and one grid cell is drawn. `POST /trades` refuses
    // the same card on both sides, so offering it here would be offering a
    // choice whose only outcome is a refusal four screens later.
    expect(grid()).toHaveLength(1);
    expect(screen.queryByText(copy.wizard.request.onlyOffered.title)).toBeNull();
  });

  it("re-filters against the live draft when the offer changes behind it", async () => {
    // Suppression here cannot see an edit made on the step behind it, so it is
    // computed from the draft on every render rather than at load time.
    draftThrough(ownedCard("card-other", "Other", 1));
    mockApi.userCards.mockResolvedValue([partnerCard("card-other", "Other")]);
    mockApi.cards.mockResolvedValue([ownedCard("card-other", "Other", 1)]);

    render(<ChooseRequest />);
    await screen.findByText(copy.wizard.request.onlyOffered.title);

    // Back to step 2, pick something else, return here. The draft is a module
    // store read through `useSyncExternalStore`, so a commit to it re-renders
    // every mounted subscriber and has to be wrapped like any other update.
    act(() => {
      chooseOffered(ownedCard("card-mine", "Mine", 1));
    });
    await refocus();

    expect(screen.queryByText(copy.wizard.request.onlyOffered.title)).toBeNull();
    expect(grid()).toHaveLength(1);
  });
});

describe("step 3 — a partner who disappeared", () => {
  it("offers a retry beside a different partner, since retrying a 404 cannot work", async () => {
    draftThrough();
    mockApi.userCards.mockRejectedValue(new ApiError(404, SERVER_SENTENCE));
    mockApi.cards.mockResolvedValue([MY_CARD]);

    render(<ChooseRequest />);

    expect(await screen.findByText(copy.wizard.request.errorTitle)).toBeOnTheScreen();
    expect(screen.getByText(SERVER_SENTENCE)).toBeOnTheScreen();
    expect(screen.getByText(copy.wizard.retry)).toBeOnTheScreen();
    expect(screen.getByText(copy.wizard.request.emptyAction)).toBeOnTheScreen();
  });

  it("draws their collection even when the viewer's own never arrives", async () => {
    // The partner's cards are the screen; the viewer's are a garnish that marks
    // duplicates, and a flaky garnish must not blank a collection that arrived.
    draftThrough();
    mockApi.userCards.mockResolvedValue([THEIR_CARD]);
    mockApi.cards.mockRejectedValue(new Error("Network request failed"));

    render(<ChooseRequest />);
    await waitFor(() => expect(mockApi.userCards).toHaveBeenCalled());

    expect(screen.queryByText(copy.wizard.request.errorTitle)).toBeNull();
    expect(grid()).toHaveLength(1);
    expect(screen.queryByText(copy.wizard.request.alsoOwned)).toBeNull();
  });

  it("marks the cards the viewer already owns when it does arrive", async () => {
    draftThrough();
    mockApi.userCards.mockResolvedValue([THEIR_CARD]);
    mockApi.cards.mockResolvedValue([MY_CARD, ownedCard("card-theirs", "Theirs", 1)]);

    render(<ChooseRequest />);

    expect(await screen.findByText(copy.wizard.request.alsoOwned)).toBeOnTheScreen();
  });

  it("names whose collection is on screen", async () => {
    draftThrough();
    mockApi.userCards.mockResolvedValue([THEIR_CARD]);
    mockApi.cards.mockResolvedValue([MY_CARD]);

    render(<ChooseRequest />);
    await waitFor(() => expect(mockApi.userCards).toHaveBeenCalled());

    expect(
      screen.getByText(fill(copy.wizard.request.title, { username: PARTNER.username }))
    ).toBeOnTheScreen();
  });
});

describe("selections the server would refuse are dropped on reload", () => {
  it("drops an offered card the viewer no longer owns", async () => {
    draftThrough();
    mockApi.cards.mockResolvedValue([MY_CARD, ownedCard("card-spare", "Spare", 1)]);
    render(<ChooseOffer />);
    expect(await screen.findByText(copy.wizard.continue)).not.toBeDisabled();

    // Accepted away in another session between focuses.
    mockApi.cards.mockResolvedValue([ownedCard("card-spare", "Spare", 1)]);
    await refocus();

    expect(screen.getByText(copy.wizard.continue)).toBeDisabled();
  });

  it("keeps the selection when the refresh itself failed", async () => {
    // A dropped connection proves nothing about who owns what, and clearing on
    // one would read a failed request as a traded card.
    draftThrough();
    mockApi.cards.mockResolvedValue([MY_CARD]);
    render(<ChooseOffer />);
    await screen.findByText(copy.wizard.continue);

    mockApi.cards.mockRejectedValue(new Error("Network request failed"));
    await refocus();
    mockApi.cards.mockResolvedValue([MY_CARD]);
    await refocus();

    expect(screen.getByText(copy.wizard.continue)).not.toBeDisabled();
  });
});
