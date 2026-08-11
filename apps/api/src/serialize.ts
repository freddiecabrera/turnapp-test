import type {
  Card as PrismaCard,
  QrCode as PrismaQrCode,
  Trade as PrismaTrade,
  User as PrismaUser,
} from "@prisma/client";
import type { Card, QrCode, Trade, User, UserSummary } from "@turnapp/shared";

/**
 * Turn a stored image filename into a path the clients can load.
 *
 * We return a RELATIVE path (e.g. "/static/cards/x.png") on purpose: each client
 * resolves it against the same host it used to reach the API. That way images work
 * automatically from a simulator (localhost), a phone on the LAN (your machine's IP),
 * or a deployed API — without any hardcoded host or per-machine env config.
 */
export function cardImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("http")) return imageUrl;
  return `/static/cards/${imageUrl}`;
}

export function toPublicUser(user: PrismaUser): User {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    userIdNumber: user.userIdNumber,
    pointsBalance: user.pointsBalance,
    isAdmin: user.isAdmin,
  };
}

export function toPublicQrCode(
  qr: PrismaQrCode & { card?: { name: string } | null; scannedByUser?: { username: string } | null }
): QrCode {
  return {
    id: qr.id,
    code: qr.code,
    cardId: qr.cardId,
    cardName: qr.card?.name ?? null,
    pointsAwarded: qr.pointsAwarded,
    batchId: qr.batchId,
    batchLabel: qr.batchLabel,
    scannedAt: qr.scannedAt ? qr.scannedAt.toISOString() : null,
    scannedByUsername: qr.scannedByUser?.username ?? null,
    createdAt: qr.createdAt.toISOString(),
  };
}

/**
 * A user as seen by somebody else. Note this is NOT `toPublicUser` — that one
 * includes the email address and is only for the caller's own account and the
 * admin views. Anything that shows one user to another goes through here.
 */
export function toUserSummary(
  user: Pick<PrismaUser, "id" | "username" | "userIdNumber">
): UserSummary {
  return {
    id: user.id,
    username: user.username,
    userIdNumber: user.userIdNumber,
  };
}

type TradeWithParties = PrismaTrade & {
  fromUser: Pick<PrismaUser, "id" | "username" | "userIdNumber">;
  toUser: Pick<PrismaUser, "id" | "username" | "userIdNumber">;
  offeredCard: PrismaCard;
  requestedCard: PrismaCard;
};

/**
 * Serialize a trade for one specific viewer.
 *
 * `direction` is resolved here rather than on the client because the stored
 * columns are sender-relative: `offeredCard` always belongs to `fromUser`, so
 * the same row means opposite things to the two parties.
 *
 * Both cards go through `toPublicCard`, which rewrites `imageUrl` into the
 * relative `/static/cards/...` form each client resolves against its own host.
 * Returning the raw Prisma cards would work in a simulator and break every
 * image on a physical device.
 *
 * `fulfillable` is required rather than defaulted. It needs an ownership lookup
 * the trade row can't answer on its own, and a default would let a caller
 * silently emit null for a live pending trade — which clients read as "already
 * answered". Pass the computed value, or an explicit null to say you didn't
 * compute it. Answered trades are forced to null either way.
 *
 * Throws for a viewer who is neither party. NOTE: Express 4 does not route
 * async rejections to the error middleware, so an uncaught throw here exits the
 * process. Callers must catch it — see the trading routes.
 */
export function toPublicTrade(
  trade: TradeWithParties,
  viewerId: string,
  fulfillable: boolean | null
): Trade {
  const isSender = trade.fromUserId === viewerId;

  // A viewer who is neither party has no direction, and quietly defaulting to
  // "received" would hand them a plausible-looking view of someone else's
  // trade. Routes already filter by participant; this catches a slip in that
  // filter rather than serving the wrong person's data.
  if (!isSender && trade.toUserId !== viewerId) {
    throw new Error(`Cannot serialize trade ${trade.id} for non-participant ${viewerId}`);
  }

  return {
    id: trade.id,
    status: trade.status,
    direction: isSender ? "sent" : "received",
    fulfillable: trade.status === "PENDING" ? fulfillable : null,
    fromUser: toUserSummary(trade.fromUser),
    toUser: toUserSummary(trade.toUser),
    offeredCard: toPublicCard(trade.offeredCard),
    requestedCard: toPublicCard(trade.requestedCard),
    createdAt: trade.createdAt.toISOString(),
    respondedAt: trade.respondedAt ? trade.respondedAt.toISOString() : null,
  };
}

export function toPublicCard(card: PrismaCard): Card {
  return {
    id: card.id,
    name: card.name,
    type: card.type,
    universe: card.universe,
    rarity: card.rarity,
    rarityLevel: card.rarityLevel,
    cardNumber: card.cardNumber,
    story: card.story,
    imageUrl: cardImageUrl(card.imageUrl),
    seasonId: card.seasonId,
  };
}
