-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "offeredCardId" TEXT NOT NULL,
    "requestedCardId" TEXT NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Trade_toUserId_status_idx" ON "Trade"("toUserId", "status");

-- CreateIndex
CREATE INDEX "Trade_fromUserId_status_idx" ON "Trade"("fromUserId", "status");

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_offeredCardId_fkey" FOREIGN KEY ("offeredCardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_requestedCardId_fkey" FOREIGN KEY ("requestedCardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below this line. Prisma's schema DSL has no syntax for partial
-- indexes or CHECK constraints, so they are appended to the generated
-- migration. See DESIGN.md.
-- ---------------------------------------------------------------------------

-- At most one OPEN offer for the same pair of people and the same pair of
-- cards. Partial on PENDING so a declined trade can legitimately be proposed
-- again later, and so completed history never blocks a new offer.
CREATE UNIQUE INDEX "Trade_one_pending_per_offer"
    ON "Trade" ("fromUserId", "toUserId", "offeredCardId", "requestedCardId")
    WHERE "status" = 'PENDING';

-- These two are true invariants — unlike ownership, they must hold for the
-- row's entire life, so the database is the right place to enforce them.
-- The API still rejects both with a 400 so users get a readable message.
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_no_self_trade"
    CHECK ("fromUserId" <> "toUserId");

ALTER TABLE "Trade" ADD CONSTRAINT "Trade_distinct_cards"
    CHECK ("offeredCardId" <> "requestedCardId");
