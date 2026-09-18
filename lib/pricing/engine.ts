export class PricingError extends Error {}

export type PricingInput = {
  volumeCm3: number;
  /** Material cost per cm³, in dollars (e.g. 0.45). */
  pricePerCm3: number;
  setupFeeCents: number;
  minPriceCents: number;
  /** Finish price multiplier, e.g. 1 for standard, 1.15 for polished. Defaults to 1. */
  finishMultiplier?: number;
  quantity: number;
};

export type PricingBreakdown = {
  unitPriceCents: number;
  totalPriceCents: number;
  materialCostCents: number;
  setupFeeCents: number;
  minPriceFloorApplied: boolean;
};

/**
 * Pure pricing function shared by the live quote endpoint and order creation,
 * so a quoted price can never drift from the price actually charged.
 *
 * unitPrice = max(minPrice, volumeCm3 * pricePerCm3 * finishMultiplier) + setupFee
 */
export function computePrice(input: PricingInput): PricingBreakdown {
  const { volumeCm3, pricePerCm3, setupFeeCents, minPriceCents, quantity } = input;
  const finishMultiplier = input.finishMultiplier ?? 1;

  if (!(volumeCm3 > 0)) throw new PricingError("volumeCm3 must be positive");
  if (!(pricePerCm3 >= 0)) throw new PricingError("pricePerCm3 must be non-negative");
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new PricingError("quantity must be a positive integer");
  }

  const materialCostCents = Math.round(volumeCm3 * pricePerCm3 * finishMultiplier * 100);
  const minPriceFloorApplied = materialCostCents < minPriceCents;
  const baseCents = Math.max(minPriceCents, materialCostCents);
  const unitPriceCents = baseCents + setupFeeCents;

  return {
    unitPriceCents,
    totalPriceCents: unitPriceCents * quantity,
    materialCostCents,
    setupFeeCents,
    minPriceFloorApplied,
  };
}
