-- DropIndex
DROP INDEX "Color_materialId_name_key";

-- AlterTable
ALTER TABLE "Color" ADD COLUMN "variant" TEXT NOT NULL DEFAULT '',
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN "externalKey" TEXT,
ADD COLUMN "stockGrams" INTEGER,
ADD COLUMN "spoolPriceCents" INTEGER;

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Color_materialId_variant_name_key" ON "Color"("materialId", "variant", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Color_materialId_externalKey_key" ON "Color"("materialId", "externalKey");
