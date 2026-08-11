import { POINT_TIERS } from "@turnapp/shared";
import { asyncRouter } from "../async-router";
import { prisma } from "../prisma";
import { requireAuth } from "../auth";
import { toPublicCard } from "../serialize";

export const appRouter = asyncRouter();

// Every app route requires a logged-in user.
appRouter.use(requireAuth);

appRouter.get("/seasons", async (_req, res) => {
  const seasons = await prisma.season.findMany({ orderBy: { name: "asc" } });
  res.json(seasons);
});

// All cards for a season, annotated with whether the current user owns them.
appRouter.get("/cards", async (req, res) => {
  const seasonId = req.query.seasonId as string | undefined;
  const cards = await prisma.card.findMany({
    where: seasonId ? { seasonId } : undefined,
    orderBy: { cardNumber: "asc" },
  });

  const owned = await prisma.userCard.findMany({
    where: { userId: req.auth!.userId },
  });
  const ownedByCardId = new Map(owned.map((uc) => [uc.cardId, uc]));

  res.json(
    cards.map((card) => {
      const uc = ownedByCardId.get(card.id);
      return { ...toPublicCard(card), owned: !!uc, quantity: uc?.quantity ?? 0 };
    })
  );
});

appRouter.get("/cards/:id", async (req, res) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!card) return res.status(404).json({ error: "Card not found" });

  const uc = await prisma.userCard.findUnique({
    where: { userId_cardId: { userId: req.auth!.userId, cardId: card.id } },
  });

  res.json({ ...toPublicCard(card), owned: !!uc, quantity: uc?.quantity ?? 0 });
});

// Scan a QR code to collect a card. Codes are single-use. A brand-new card
// awards its points; a duplicate just increments the owned quantity.
appRouter.post("/scan", async (req, res) => {
  const code = String(req.body?.code ?? "").trim();
  if (!code) return res.status(400).json({ error: "A code is required" });

  const qr = await prisma.qrCode.findUnique({ where: { code }, include: { card: true } });
  if (!qr) return res.status(404).json({ error: "Invalid code — no matching card" });
  if (qr.scannedAt) {
    return res.status(409).json({ error: "This code has already been scanned" });
  }

  const userId = req.auth!.userId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Atomically claim the code so it can't be double-collected.
      const claim = await tx.qrCode.updateMany({
        where: { id: qr.id, scannedAt: null },
        data: { scannedAt: new Date(), scannedByUserId: userId },
      });
      if (claim.count === 0) throw new Error("ALREADY_SCANNED");

      // Read only to decide the points award, never to compute the new
      // quantity. `existing.quantity + 1` is an absolute value derived from a
      // stale read: under READ COMMITTED another writer of this row blocks the
      // write below, commits, and then this overwrites what it just did.
      const existing = await tx.userCard.findUnique({
        where: { userId_cardId: { userId, cardId: qr.cardId } },
        select: { id: true },
      });
      const alreadyOwned = !!existing;

      // Relative, and keyed by (userId, cardId) rather than the id read above,
      // so this adds exactly one copy however the row changed in between — an
      // accepted trade may have incremented it, or deleted it outright. The
      // same upsert `moveCard` uses; see DESIGN.md, "The swap".
      await tx.userCard.upsert({
        where: { userId_cardId: { userId, cardId: qr.cardId } },
        create: { userId, cardId: qr.cardId, quantity: 1 },
        update: { quantity: { increment: 1 } },
      });

      let pointsAwarded = 0;
      if (!alreadyOwned) {
        pointsAwarded = qr.pointsAwarded;
        await tx.pointsTransaction.create({
          data: { userId, amount: pointsAwarded, description: `Scanned ${qr.card.name}` },
        });
        await tx.user.update({
          where: { id: userId },
          data: { pointsBalance: { increment: pointsAwarded } },
        });
      }

      const user = await tx.user.findUnique({ where: { id: userId } });
      const uc = await tx.userCard.findUnique({
        where: { userId_cardId: { userId, cardId: qr.cardId } },
      });
      return {
        pointsAwarded,
        alreadyOwned,
        newBalance: user!.pointsBalance,
        quantity: uc!.quantity,
      };
    });

    res.json({
      card: { ...toPublicCard(qr.card), owned: true, quantity: result.quantity },
      pointsAwarded: result.pointsAwarded,
      newBalance: result.newBalance,
      alreadyOwned: result.alreadyOwned,
    });
  } catch (e) {
    if ((e as Error).message === "ALREADY_SCANNED") {
      return res.status(409).json({ error: "This code has already been scanned" });
    }
    throw e;
  }
});

appRouter.get("/wallet", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const transactions = await prisma.pointsTransaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    pointsBalance: user.pointsBalance,
    tiers: [...POINT_TIERS],
    transactions: transactions.map((t) => ({
      id: t.id,
      amount: t.amount,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});
