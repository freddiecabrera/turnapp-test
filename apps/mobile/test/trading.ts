import { useEffect } from "react";
import { act } from "@testing-library/react-native";
import type { Card, CardWithOwnership, OwnedCard, Trade, UserSummary } from "../src/types";

/**
 * Fixtures and mock factories for the trading screen suites.
 *
 * Outside `__tests__/` on purpose. Jest's default `testMatch` collects
 * **every** file under a `__tests__` directory, not only `*.test.*`, so a
 * helper module placed beside the suites is picked up as a suite of its own and
 * fails with "Your test suite must contain at least one test." Sitting here it
 * is imported by the suites and matched by none of them, which is also the
 * layout `apps/api/test/helpers.ts` already uses.
 *
 * Nothing in this file asserts. It builds the DTOs `GET /trades` and
 * `GET /cards` return, so a screen test can state the one field it is about and
 * inherit a valid trade for the rest — a fixture spelled out per case is a
 * fixture that drifts from the serializer.
 */

/** A card as `toPublicCard` emits it. `imageUrl` is null so no `Image` fetches. */
export function card(id: string, name: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    name,
    type: "Character",
    universe: "Turn",
    rarity: "Rare",
    rarityLevel: 2,
    cardNumber: "001",
    story: null,
    imageUrl: null,
    seasonId: "szn-1",
    ...overrides,
  };
}

/** The same card as `GET /cards` returns it, with the viewer's ownership on it. */
export function ownedCard(
  id: string,
  name: string,
  quantity: number,
  overrides: Partial<CardWithOwnership> = {}
): CardWithOwnership {
  return { ...card(id, name), owned: quantity > 0, quantity, ...overrides };
}

/** The same card as `GET /users/:id/cards` returns it — always held, so always >= 1. */
export function partnerCard(
  id: string,
  name: string,
  quantity = 1,
  overrides: Partial<OwnedCard> = {}
): OwnedCard {
  return {
    ...card(id, name),
    quantity,
    firstScannedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function userSummary(id: string, username: string, userIdNumber = 1): UserSummary {
  return { id, username, userIdNumber };
}

/**
 * The card names every trade fixture below carries.
 *
 * Named rather than inlined because the give/get assertions turn entirely on
 * which of the two lands on which side, and two literals a screen apart are two
 * chances to compare a card against itself.
 */
export const OFFERED_NAME = "Offered Original";
export const REQUESTED_NAME = "Requested Original";

/**
 * One trade, in the shape `toPublicTrade` emits.
 *
 * `direction` and `fulfillable` are the two fields the screens reason hardest
 * about, so they are the ones a caller is expected to set. The default is the
 * only combination the board treats as actionable — received, pending, still
 * fulfillable — because every other variant is defined by how it differs from
 * that one.
 */
export function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "trade-1",
    status: "PENDING",
    direction: "received",
    fulfillable: true,
    // `fromUser` sent the offer, so `offeredCard` is theirs and `requestedCard`
    // is the other party's. The serializer never inverts these columns; only
    // `direction` says which side the viewer is on.
    fromUser: userSummary("user-sender", "sender", 11),
    toUser: userSummary("user-recipient", "recipient", 22),
    offeredCard: card("card-offered", OFFERED_NAME),
    requestedCard: card("card-requested", REQUESTED_NAME),
    createdAt: "2026-01-01T00:00:00.000Z",
    respondedAt: null,
    ...overrides,
  };
}

/** Every navigation call the trading screens make, as spies. */
export interface RouterSpy {
  push: jest.Mock;
  back: jest.Mock;
  replace: jest.Mock;
  navigate: jest.Mock;
  dismissTo: jest.Mock;
  dismissAll: jest.Mock;
  canGoBack: jest.Mock;
}

export function routerSpy(): RouterSpy {
  return {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
    dismissTo: jest.fn(),
    dismissAll: jest.fn(),
    canGoBack: jest.fn(() => true),
  };
}

let latestFocusCallback: (() => void | (() => void)) | null = null;

/**
 * `useFocusEffect` as a plain `useEffect`.
 *
 * Four of the five trading screens load their data in one, and without this
 * they never fetch at all: the real hook comes from React Navigation and wants
 * a navigator above the component. Running the callback on mount is what a
 * focus does the first time.
 *
 * The callback is also kept, because a *re*-focus is the only way into several
 * states — a refresh that fails over rows already on screen, a picker reloading
 * after the review step sent somebody back to it — and re-rendering does not
 * produce one. Each screen wraps its `load` in a `useCallback` with a stable
 * dependency list, so the effect fires once on mount and never again however
 * many times the component re-renders.
 */
export function focusEffectAsEffect(callback: () => void | (() => void)): void {
  latestFocusCallback = callback;
  useEffect(callback, [callback]);
}

/**
 * Re-run the last registered focus callback, the way returning to a screen does.
 *
 * The `setImmediate` is what makes the whole load land inside `act`. These
 * callbacks fire an async `load` and do not await it, so returning from the
 * callback leaves the request, its `.then`/`.catch` and the `finally` that
 * clears `loading` still queued — and each state update they make afterwards is
 * an update outside `act`, which React reports as a warning and which leaves
 * the assertion that follows reading a half-settled screen.
 */
export async function refocus(): Promise<void> {
  const callback = latestFocusCallback;
  if (callback === null) throw new Error("no screen has registered a focus effect");
  await act(async () => {
    callback();
    await new Promise((resolve) => setImmediate(resolve));
  });
}

/** Called from `beforeEach`, so one case's screen cannot be refocused by the next. */
export function resetFocus(): void {
  latestFocusCallback = null;
}

/**
 * Let every queued promise settle, inside `act`.
 *
 * For a case that asserts on something drawn *before* a request answers and
 * would otherwise finish with that request still in flight — whose resolution
 * then updates a component after the test is over, outside `act`.
 */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
}

/** A promise plus the handles to settle it, for asserting on an in-flight request. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A rejection asserted on synchronously is still unhandled for a tick, and
  // Node fails the run for it. The screens under test always attach a catch.
  promise.catch(() => {});
  return { promise, resolve, reject };
}
