// Mirror of packages/shared. The mobile app keeps a local copy so Metro doesn't
// need to resolve outside its own folder (kept in sync intentionally).

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

export interface WalletResponse {
  pointsBalance: number;
  tiers: number[];
  transactions: PointsTransaction[];
}

export interface ScanResult {
  card: CardWithOwnership;
  pointsAwarded: number;
  newBalance: number;
  alreadyOwned: boolean;
}

/** A trade's lifecycle. Only PENDING trades can be acted on. */
export type TradeStatus = "PENDING" | "ACCEPTED" | "DECLINED";

/** A user as seen by somebody else — no email, no points balance. */
export interface UserSummary {
  id: string;
  username: string;
  userIdNumber: number;
}

export interface Trade {
  id: string;
  status: TradeStatus;
  /**
   * Which side of the trade you're on. `offeredCard` always comes from
   * `fromUser`, so the same row reads inverted for the two parties — use this
   * to work out which card you're giving up.
   */
  direction: "sent" | "received";
  /**
   * Both sides still own their cards. `null` means not applicable — either
   * the trade was answered, or this endpoint didn't compute it. Not `false`.
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

export const POINT_TIERS = [100, 500, 1000, 5000, 10000];
