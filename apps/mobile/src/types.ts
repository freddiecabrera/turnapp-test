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

export interface AuthResponse {
  token: string;
  user: User;
}

export const POINT_TIERS = [100, 500, 1000, 5000, 10000];
