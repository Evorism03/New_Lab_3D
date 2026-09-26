import { resolvePricing, type MaterialPricingRow } from "./defaults";
import { computePrice, type PricingBreakdown } from "./engine";
import { effectiveFillShare } from "./options";

type MaterialForPricing = MaterialPricingRow & {
  setupFeeCents: number;
  minPriceCents: number;
};

/**
 * Quote for one material: its stored (or recommended) time/plastic settings + the shared formula.
 * A color with its own spool price (e.g. a composite like ABS-CF15) overrides the material's.
 * `infillPercent` is the customer's slicer infill: it changes the plastic used and — since the
 * printer lays down that plastic — the print time in the same proportion.
 */
export function computeMaterialPrice(
  material: MaterialForPricing,
  input: { volumeCm3: number; finishMultiplier?: number; quantity: number; infillPercent?: number },
  color?: { spoolPriceCents: number | null } | null,
): PricingBreakdown {
  const pricing = resolvePricing(material);
  const { infillPercent: slicerInfill, ...rest } = input;
  const share = slicerInfill === undefined ? pricing.infillPercent : effectiveFillShare(slicerInfill, pricing.infillPercent);
  return computePrice({
    ...pricing,
    infillPercent: share,
    printSpeedCm3PerHour: (pricing.printSpeedCm3PerHour * pricing.infillPercent) / share,
    spoolPriceCents: color?.spoolPriceCents ?? pricing.spoolPriceCents,
    setupFeeCents: material.setupFeeCents,
    minPriceCents: material.minPriceCents,
    ...rest,
  });
}
