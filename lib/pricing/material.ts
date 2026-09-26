import { resolvePricing, type MaterialPricingRow } from "./defaults";
import { computePrice, type PricingBreakdown } from "./engine";

type MaterialForPricing = MaterialPricingRow & {
  setupFeeCents: number;
  minPriceCents: number;
};

/** Quote for one material: its stored (or recommended) time/plastic settings + the shared formula. */
export function computeMaterialPrice(
  material: MaterialForPricing,
  input: { volumeCm3: number; finishMultiplier?: number; quantity: number },
): PricingBreakdown {
  return computePrice({
    ...resolvePricing(material),
    setupFeeCents: material.setupFeeCents,
    minPriceCents: material.minPriceCents,
    ...input,
  });
}
