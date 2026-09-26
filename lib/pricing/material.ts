import { resolvePricing, type MaterialPricingRow } from "./defaults";
import { computePrice, type PricingBreakdown } from "./engine";

type MaterialForPricing = MaterialPricingRow & {
  setupFeeCents: number;
  minPriceCents: number;
};

/**
 * Quote for one material: its stored (or recommended) time/plastic settings + the shared formula.
 * A color with its own spool price (e.g. a composite like ABS-CF15) overrides the material's.
 */
export function computeMaterialPrice(
  material: MaterialForPricing,
  input: { volumeCm3: number; finishMultiplier?: number; quantity: number },
  color?: { spoolPriceCents: number | null } | null,
): PricingBreakdown {
  const pricing = resolvePricing(material);
  return computePrice({
    ...pricing,
    spoolPriceCents: color?.spoolPriceCents ?? pricing.spoolPriceCents,
    setupFeeCents: material.setupFeeCents,
    minPriceCents: material.minPriceCents,
    ...input,
  });
}
