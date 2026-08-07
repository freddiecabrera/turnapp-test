import type {
  Card as PrismaCard,
  QrCode as PrismaQrCode,
  User as PrismaUser,
} from "@prisma/client";
import type { Card, QrCode, User } from "@turnapp/shared";

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
