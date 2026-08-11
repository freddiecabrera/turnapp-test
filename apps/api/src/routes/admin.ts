import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { asyncRouter } from "../async-router";
import { prisma } from "../prisma";
import { requireAuth, requireAdmin } from "../auth";
import { toPublicCard, toPublicQrCode, toPublicUser } from "../serialize";

export const adminRouter = asyncRouter();

const cardsDir = path.resolve(__dirname, "../../static/cards");
fs.mkdirSync(cardsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, cardsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `card_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

adminRouter.use(requireAuth, requireAdmin);

// ---- Cards CRUD ----

adminRouter.get("/cards", async (_req, res) => {
  const cards = await prisma.card.findMany({ orderBy: { createdAt: "asc" } });
  res.json(cards.map(toPublicCard));
});

adminRouter.post("/cards", upload.single("image"), async (req, res) => {
  const b = req.body ?? {};
  if (!b.name || !b.seasonId) {
    return res.status(400).json({ error: "name and seasonId are required" });
  }
  const card = await prisma.card.create({
    data: {
      name: b.name,
      type: b.type || null,
      universe: b.universe || null,
      rarity: b.rarity || null,
      rarityLevel: b.rarityLevel ? Number(b.rarityLevel) : null,
      cardNumber: b.cardNumber || null,
      story: b.story || null,
      imageUrl: req.file ? req.file.filename : b.imageUrl || null,
      seasonId: b.seasonId,
    },
  });
  res.status(201).json(toPublicCard(card));
});

adminRouter.put("/cards/:id", upload.single("image"), async (req, res) => {
  const b = req.body ?? {};
  const existing = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Card not found" });

  const card = await prisma.card.update({
    where: { id: req.params.id },
    data: {
      name: b.name ?? existing.name,
      type: b.type ?? existing.type,
      universe: b.universe ?? existing.universe,
      rarity: b.rarity ?? existing.rarity,
      rarityLevel: b.rarityLevel !== undefined ? Number(b.rarityLevel) : existing.rarityLevel,
      cardNumber: b.cardNumber ?? existing.cardNumber,
      story: b.story ?? existing.story,
      imageUrl: req.file ? req.file.filename : b.imageUrl ?? existing.imageUrl,
      seasonId: b.seasonId ?? existing.seasonId,
    },
  });
  res.json(toPublicCard(card));
});

adminRouter.delete("/cards/:id", async (req, res) => {
  await prisma.card.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Ownership + QR stats for a single card ("how many people have it").
adminRouter.get("/cards/:id/stats", async (req, res) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!card) return res.status(404).json({ error: "Card not found" });

  const [owners, qrTotal, qrScanned] = await Promise.all([
    prisma.userCard.findMany({
      where: { cardId: card.id },
      include: { user: true },
      orderBy: { firstScannedAt: "asc" },
    }),
    prisma.qrCode.count({ where: { cardId: card.id } }),
    prisma.qrCode.count({ where: { cardId: card.id, scannedAt: { not: null } } }),
  ]);

  res.json({
    card: toPublicCard(card),
    ownersCount: owners.length,
    totalCopies: owners.reduce((sum, o) => sum + o.quantity, 0),
    owners: owners.map((o) => ({
      username: o.user.username,
      userIdNumber: o.user.userIdNumber,
      quantity: o.quantity,
      firstScannedAt: o.firstScannedAt.toISOString(),
    })),
    qrTotal,
    qrScanned,
  });
});

// ---- Collections (seasons) ----

// Collections with roll-up counts for the top-level admin view.
adminRouter.get("/collections", async (_req, res) => {
  const seasons = await prisma.season.findMany({
    orderBy: { cards: { _count: "desc" } },
    include: { _count: { select: { cards: true } } },
  });

  const result = await Promise.all(
    seasons.map(async (s) => {
      const [qrTotal, qrScanned] = await Promise.all([
        prisma.qrCode.count({ where: { card: { seasonId: s.id } } }),
        prisma.qrCode.count({ where: { card: { seasonId: s.id }, scannedAt: { not: null } } }),
      ]);
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        cardCount: s._count.cards,
        qrTotal,
        qrScanned,
      };
    })
  );

  res.json(result);
});

// Create a new collection (season).
adminRouter.post("/collections", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const description = req.body?.description ? String(req.body.description).trim() : null;
  if (!name) return res.status(400).json({ error: "A name is required" });

  const existing = await prisma.season.findUnique({ where: { name } });
  if (existing) return res.status(409).json({ error: "A collection with that name already exists" });

  const season = await prisma.season.create({ data: { name, description } });
  res.status(201).json({
    id: season.id,
    name: season.name,
    description: season.description,
    cardCount: 0,
    qrTotal: 0,
    qrScanned: 0,
  });
});

// ---- QR codes ----

// Create a batch of single-use codes for a card.
adminRouter.post("/qrcodes/batch", async (req, res) => {
  const cardId = String(req.body?.cardId ?? "");
  const count = Number(req.body?.count);
  const pointsAwarded = req.body?.pointsAwarded ? Number(req.body.pointsAwarded) : 50;
  const batchLabel = req.body?.batchLabel ? String(req.body.batchLabel) : null;

  if (!cardId) return res.status(400).json({ error: "cardId is required" });
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    return res.status(400).json({ error: "count must be between 1 and 500" });
  }
  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (!card) return res.status(404).json({ error: "Card not found" });

  const batchId = crypto.randomUUID();
  const codes = Array.from(
    { length: count },
    () => `TURN-${crypto.randomBytes(9).toString("hex").toUpperCase()}`
  );
  await prisma.qrCode.createMany({
    data: codes.map((code) => ({ code, cardId, pointsAwarded, batchId, batchLabel })),
  });

  const created = await prisma.qrCode.findMany({
    where: { code: { in: codes } },
    include: { card: true, scannedByUser: true },
    orderBy: { createdAt: "asc" },
  });
  res.status(201).json(created.map(toPublicQrCode));
});

// List codes (optionally filtered by card or scan status) with who/when scanned.
adminRouter.get("/qrcodes", async (req, res) => {
  const cardId = req.query.cardId as string | undefined;
  const status = req.query.status as string | undefined; // "scanned" | "unused"

  const codes = await prisma.qrCode.findMany({
    where: {
      ...(cardId ? { cardId } : {}),
      ...(status === "scanned"
        ? { scannedAt: { not: null } }
        : status === "unused"
          ? { scannedAt: null }
          : {}),
    },
    include: { card: true, scannedByUser: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(codes.map(toPublicQrCode));
});

adminRouter.delete("/qrcodes/:id", async (req, res) => {
  await prisma.qrCode.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// ---- Users ----

adminRouter.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  res.json(users.map(toPublicUser));
});

// Full detail for one user: their collection + points history.
adminRouter.get("/users/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const [owned, transactions] = await Promise.all([
    prisma.userCard.findMany({
      where: { userId: user.id },
      include: { card: true },
      orderBy: { card: { cardNumber: "asc" } },
    }),
    prisma.pointsTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  res.json({
    user: toPublicUser(user),
    cards: owned.map((uc) => ({
      ...toPublicCard(uc.card),
      quantity: uc.quantity,
      firstScannedAt: uc.firstScannedAt.toISOString(),
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      amount: t.amount,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

// Add a points transaction and keep the user's balance in sync.
adminRouter.post("/users/:id/points", async (req, res) => {
  const amount = Number(req.body?.amount);
  const description = String(req.body?.description || "Admin adjustment");
  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ error: "amount must be a non-zero number" });
  }

  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.pointsTransaction.create({
      data: { userId: user.id, amount, description },
    });
    return tx.user.update({
      where: { id: user.id },
      data: { pointsBalance: user.pointsBalance + amount },
    });
  });

  res.json(toPublicUser(updated));
});
