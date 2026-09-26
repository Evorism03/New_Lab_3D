export class PricingError extends Error {}

export type PricingInput = {
  volumeCm3: number;
  /** Printer time, kopecks per hour. The other *Cents fields are kopecks too. */
  hourlyRateCents: number;
  /** Model volume the printer gets through per hour, cm³/h. */
  printSpeedCm3PerHour: number;
  spoolPriceCents: number;
  spoolWeightG: number;
  densityGcm3: number;
  /** Share of the solid volume that is actually printed, 1-100. */
  infillPercent: number;
  /** Flat charge for starting a job. */
  setupFeeCents: number;
  minPriceCents: number;
  /** Finish price multiplier, e.g. 1 for standard, 1.15 for sanded. Defaults to 1. */
  finishMultiplier?: number;
  quantity: number;
};

export type PricingBreakdown = {
  unitPriceCents: number;
  totalPriceCents: number;
  /** Time + plastic (after the finish multiplier), before the minimum-price floor and setup fee. */
  materialCostCents: number;
  timeCostCents: number;
  plasticCostCents: number;
  setupFeeCents: number;
  minPriceFloorApplied: boolean;
  /** Estimated printing time of one piece / of the whole order, hours. */
  printHoursPerUnit: number;
  printHoursTotal: number;
  /** Estimated plastic use for the whole order, grams. */
  plasticGramsTotal: number;
};

/**
 * Pure pricing function shared by the live quote endpoint and order creation,
 * so a quoted price can never drift from the price actually charged.
 *
 * hours    = volume / printSpeed
 * grams    = volume * infill% * density
 * subtotal = (hours * hourlyRate + grams * spoolPrice / spoolWeight) * finishMultiplier
 * unitPrice = max(minPrice, subtotal) + setupFee
 */
export function computePrice(input: PricingInput): PricingBreakdown {
  const {
    volumeCm3,
    hourlyRateCents,
    printSpeedCm3PerHour,
    spoolPriceCents,
    spoolWeightG,
    densityGcm3,
    infillPercent,
    setupFeeCents,
    minPriceCents,
    quantity,
  } = input;
  const finishMultiplier = input.finishMultiplier ?? 1;

  if (!(volumeCm3 > 0)) throw new PricingError("volumeCm3 must be positive");
  if (!(hourlyRateCents >= 0)) throw new PricingError("hourlyRateCents must be non-negative");
  if (!(printSpeedCm3PerHour > 0)) throw new PricingError("printSpeedCm3PerHour must be positive");
  if (!(spoolWeightG > 0)) throw new PricingError("spoolWeightG must be positive");
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new PricingError("quantity must be a positive integer");
  }

  const printHoursPerUnit = volumeCm3 / printSpeedCm3PerHour;
  const plasticGramsPerUnit = ((volumeCm3 * infillPercent) / 100) * densityGcm3;

  const timeCostCents = Math.round(printHoursPerUnit * hourlyRateCents * finishMultiplier);
  const plasticCostCents = Math.round(
    ((plasticGramsPerUnit * spoolPriceCents) / spoolWeightG) * finishMultiplier,
  );
  const materialCostCents = timeCostCents + plasticCostCents;
  const minPriceFloorApplied = materialCostCents < minPriceCents;
  const unitPriceCents = Math.max(minPriceCents, materialCostCents) + setupFeeCents;

  return {
    unitPriceCents,
    totalPriceCents: unitPriceCents * quantity,
    materialCostCents,
    timeCostCents,
    plasticCostCents,
    setupFeeCents,
    minPriceFloorApplied,
    printHoursPerUnit,
    printHoursTotal: printHoursPerUnit * quantity,
    plasticGramsTotal: plasticGramsPerUnit * quantity,
  };
}
