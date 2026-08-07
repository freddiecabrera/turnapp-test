-- AlterTable
ALTER TABLE "QrCode" ADD COLUMN "batchId" TEXT;

-- CreateIndex
CREATE INDEX "QrCode_batchId_idx" ON "QrCode"("batchId");
