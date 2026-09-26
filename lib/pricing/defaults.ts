// Time-based pricing inputs of one material. In the database every field is optional:
// NULL means "use the recommended value for this material" (by slug), so existing rows work
// right after `prisma db push` and the admin only overrides what differs.

export type ResolvedPricing = {
  /** Printer time, kopecks per hour. */
  hourlyRateCents: number;
  /** How many cm³ of the model get printed per hour. */
  printSpeedCm3PerHour: number;
  /** Price of one spool, kopecks. */
  spoolPriceCents: number;
  /** Grams of plastic on one spool. */
  spoolWeightG: number;
  /** g/cm³. */
  densityGcm3: number;
  /** Share of the solid volume that is actually printed (walls + infill), 1-100. */
  infillPercent: number;
};

const rub = (n: number) => n * 100;

const RECOMMENDED: Record<string, ResolvedPricing> = {
  pla: { hourlyRateCents: rub(120), printSpeedCm3PerHour: 12, spoolPriceCents: rub(1800), spoolWeightG: 1000, densityGcm3: 1.24, infillPercent: 40 },
  petg: { hourlyRateCents: rub(140), printSpeedCm3PerHour: 12, spoolPriceCents: rub(2000), spoolWeightG: 1000, densityGcm3: 1.27, infillPercent: 40 },
  abs: { hourlyRateCents: rub(150), printSpeedCm3PerHour: 12, spoolPriceCents: rub(1800), spoolWeightG: 1000, densityGcm3: 1.04, infillPercent: 40 },
  pet: { hourlyRateCents: rub(140), printSpeedCm3PerHour: 12, spoolPriceCents: rub(2000), spoolWeightG: 1000, densityGcm3: 1.38, infillPercent: 40 },
  tpu: { hourlyRateCents: rub(180), printSpeedCm3PerHour: 6, spoolPriceCents: rub(3000), spoolWeightG: 1000, densityGcm3: 1.21, infillPercent: 40 },
  pa: { hourlyRateCents: rub(220), printSpeedCm3PerHour: 8, spoolPriceCents: rub(5500), spoolWeightG: 1000, densityGcm3: 1.14, infillPercent: 40 },
  pc: { hourlyRateCents: rub(250), printSpeedCm3PerHour: 8, spoolPriceCents: rub(4500), spoolWeightG: 1000, densityGcm3: 1.2, infillPercent: 40 },
  pp: { hourlyRateCents: rub(200), printSpeedCm3PerHour: 8, spoolPriceCents: rub(3500), spoolWeightG: 1000, densityGcm3: 0.9, infillPercent: 40 },
};

const GENERIC: ResolvedPricing = RECOMMENDED.pla;

type Numeric = number | { toString(): string } | null | undefined;

export type MaterialPricingRow = {
  slug: string;
  hourlyRateCents: Numeric;
  printSpeedCm3PerHour: Numeric;
  spoolPriceCents: Numeric;
  spoolWeightG: Numeric;
  densityGcm3: Numeric;
  infillPercent: Numeric;
};

const pick = (value: Numeric, fallback: number) => {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function resolvePricing(material: MaterialPricingRow): ResolvedPricing {
  const base = RECOMMENDED[material.slug] ?? GENERIC;
  return {
    hourlyRateCents: pick(material.hourlyRateCents, base.hourlyRateCents),
    printSpeedCm3PerHour: pick(material.printSpeedCm3PerHour, base.printSpeedCm3PerHour),
    spoolPriceCents: pick(material.spoolPriceCents, base.spoolPriceCents),
    spoolWeightG: pick(material.spoolWeightG, base.spoolWeightG),
    densityGcm3: pick(material.densityGcm3, base.densityGcm3),
    infillPercent: pick(material.infillPercent, base.infillPercent),
  };
}
