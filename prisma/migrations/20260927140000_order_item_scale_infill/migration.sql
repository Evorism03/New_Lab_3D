-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "scalePercent" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN "infillPercent" INTEGER;
