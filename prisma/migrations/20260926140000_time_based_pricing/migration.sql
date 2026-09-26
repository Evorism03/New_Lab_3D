-- AlterTable
ALTER TABLE "Material" ALTER COLUMN "pricePerCm3" SET DEFAULT 0,
ADD COLUMN     "hourlyRateCents" INTEGER,
ADD COLUMN     "printSpeedCm3PerHour" DECIMAL(8,2),
ADD COLUMN     "spoolPriceCents" INTEGER,
ADD COLUMN     "spoolWeightG" INTEGER,
ADD COLUMN     "densityGcm3" DECIMAL(6,3),
ADD COLUMN     "infillPercent" INTEGER;
