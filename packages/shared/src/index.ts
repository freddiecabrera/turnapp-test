// Shared types used by the API, mobile app, and admin dashboard.
// Keep this dependency-free so it can be imported everywhere.

export interface User {
  id: string;
  username: string;
  email: string;
  userIdNumber: number;
  pointsBalance: number;
  isAdmin: boolean;
}

export interface Season {
  id: string;
  name: string;
  description: string | null;
}

export interface Card {
  id: string;
  name: string;
  type: string | null;
  universe: string | null;
  rarity: string | null;
  rarityLevel: number | null;
  cardNumber: string | null;
  story: string | null;
  imageUrl: string | null;
  seasonId: string;
}

/** A card annotated with the current user's ownership. Returned by GET /cards. */
export interface CardWithOwnership extends Card {
  owned: boolean;
  quantity: number;
}

export interface PointsTransaction {
  id: string;
  amount: number;
  description: string;
  createdAt: string;
}

/** A card a user owns, with collection metadata. */
export interface OwnedCard extends Card {
  quantity: number;
  firstScannedAt: string;
}

/** Full detail for a single user, used by the admin dashboard. */
export interface AdminUserDetail {
  user: User;
  cards: OwnedCard[];
  transactions: PointsTransaction[];
}

/** A collection (season) with roll-up counts for the admin dashboard. */
export interface AdminCollection {
  id: string;
  name: string;
  description: string | null;
  cardCount: number;
  qrTotal: number;
  qrScanned: number;
}

/** A single-use QR code that grants a card + points when scanned. */
export interface QrCode {
  id: string;
  code: string;
  cardId: string;
  cardName: string | null;
  pointsAwarded: number;
  batchId: string | null;
  batchLabel: string | null;
  scannedAt: string | null;
  scannedByUsername: string | null;
  createdAt: string;
}

/** Result returned to the mobile app after scanning a code. */
export interface ScanResult {
  card: CardWithOwnership;
  pointsAwarded: number;
  newBalance: number;
  alreadyOwned: boolean;
}

/** One owner of a card (admin card-stats view). */
export interface CardOwner {
  username: string;
  userIdNumber: number;
  quantity: number;
  firstScannedAt: string;
}

/** Ownership + QR stats for a single card (admin). */
export interface CardStats {
  card: Card;
  ownersCount: number;
  totalCopies: number;
  owners: CardOwner[];
  qrTotal: number;
  qrScanned: number;
}

/** The five loyalty tiers shown on the home + wallet progress bar. */
export const POINT_TIERS = [100, 500, 1000, 5000, 10000] as const;

export interface WalletResponse {
  pointsBalance: number;
  tiers: number[];
  transactions: PointsTransaction[];
}

/** A trade's lifecycle. Only PENDING trades can be acted on. */
export type TradeStatus = "PENDING" | "ACCEPTED" | "DECLINED";

/**
 * A user as seen by somebody else. Deliberately smaller than `User`: no email,
 * no points balance, nothing beyond what's needed to recognise a trading
 * partner. `toPublicUser` is for the caller's own account and the admin views.
 */
export interface UserSummary {
  id: string;
  username: string;
  userIdNumber: number;
}

export interface Trade {
  id: string;
  status: TradeStatus;
  /**
   * Which side of the trade the caller is on. The stored column names are
   * sender-relative — `offeredCard` always comes from `fromUser` — so the same
   * row reads inverted for the two parties. Clients use this to work out which
   * card they're giving up rather than inferring it from the token.
   */
  direction: "sent" | "received";
  /**
   * Whether both sides still own their cards, so the trade could still go
   * through. Derived at read time rather than stored, because several pending
   * trades can legitimately name the same card and only some of them stay
   * possible. `null` means not applicable: the trade has been answered, or
   * the endpoint did not compute it. Never treat `null` as `false`.
   */
  fulfillable: boolean | null;
  fromUser: UserSummary;
  toUser: UserSummary;
  offeredCard: Card;
  requestedCard: Card;
  createdAt: string;
  respondedAt: string | null;
}

export interface CreateTradeRequest {
  toUserId: string;
  offeredCardId: string;
  requestedCardId: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface LoginRequest {
  email: string;
  password: string;
}
