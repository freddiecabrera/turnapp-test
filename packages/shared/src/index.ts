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

export interface AuthResponse {
  token: string;
  user: User;
}

export interface LoginRequest {
  email: string;
  password: string;
}
