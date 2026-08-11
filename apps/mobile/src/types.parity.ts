// Compiler-checked parity between `./types` and `packages/shared/src`.
//
// The mobile app keeps its own copy of the shared DTOs on purpose: it is
// deliberately outside the npm workspace so Metro never resolves past its own
// folder (AGENTS.md, quirk 1). Two copies of one contract, kept in step by
// hand, is precisely the thing nothing checks — and it had already slipped
// before this file existed. `POINT_TIERS` was `as const` in shared and a bare
// `number[]` here: the same name, a different type, and no error anywhere.
//
// This is the check. It holds no runtime behaviour anyone consumes and nothing
// imports it, so it never enters the Metro graph — expo-router's
// `require.context` is rooted at `app/`, and `src/` reaches the bundle only by
// being imported. `tsc --noEmit` does read it, via the `**/*.ts` include in
// tsconfig.json, and that is already part of `npm run verify`.
//
// It is also the only place allowed to reach across the folder boundary, and it
// does so with `import type`, which is erased before any bundler could care.

import type * as Shared from "../../../packages/shared/src";
import type * as Local from "./types";

/** True only when the two types are each assignable to the other. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * `true` when the two sides are the same type, `never` otherwise.
 *
 * `never` rather than `false` so the assertion below fails at the exact entry
 * that drifted: `true` is assignable to `boolean` but not to `never`.
 *
 * The `keyof` clause is not redundant with the `Exact` above it. Mutual
 * assignability alone does not notice an added *optional* field — `{ a: 1 }`
 * and `{ a: 1; b?: 2 }` are assignable both ways, so a mirror that quietly grew
 * `note?: string` on one side would pass. Comparing the key sets catches it.
 */
type Mirrors<A, B> =
  Exact<A, B> extends true ? (Exact<keyof A, keyof B> extends true ? true : never) : never;

/**
 * One entry per type that exists on both sides. Adding a mirrored type means
 * adding a line here and a `true` below; anything that drifts turns its own
 * entry into `never` and the assignment stops compiling on that line.
 */
type Parity = [
  Mirrors<Shared.User, Local.User>,
  Mirrors<Shared.Season, Local.Season>,
  Mirrors<Shared.Card, Local.Card>,
  Mirrors<Shared.CardWithOwnership, Local.CardWithOwnership>,
  Mirrors<Shared.PointsTransaction, Local.PointsTransaction>,
  Mirrors<Shared.WalletResponse, Local.WalletResponse>,
  Mirrors<Shared.ScanResult, Local.ScanResult>,
  Mirrors<Shared.TradeStatus, Local.TradeStatus>,
  Mirrors<Shared.UserSummary, Local.UserSummary>,
  Mirrors<Shared.Trade, Local.Trade>,
  Mirrors<Shared.CreateTradeRequest, Local.CreateTradeRequest>,
  Mirrors<Shared.AuthResponse, Local.AuthResponse>,
  // A value, not an interface, and the one that had actually drifted — `as
  // const` on one side and not the other made these different types.
  Mirrors<typeof Shared.POINT_TIERS, typeof Local.POINT_TIERS>,
];

/**
 * The assertion itself.
 *
 * A tuple type containing `never` is not an error on its own — something has to
 * try to produce a value of it. Hence the array of `true`s: each one is checked
 * against its own position, so the compiler names the type that drifted rather
 * than reporting the whole tuple.
 *
 * Deliberately not exported. Nothing should import this module; it exists to be
 * typechecked.
 */
const _parity: Parity = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

// Referenced so the declaration cannot read as forgotten dead code.
export type ParityChecked = typeof _parity;
