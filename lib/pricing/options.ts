// Customer options on top of a material's pricing: model scale and slicer infill.

export const MIN_SCALE_PERCENT = 10;
export const MAX_SCALE_PERCENT = 500;

/** Scaling every side by s% scales the volume by (s/100)³. */
export function scaledVolume(volumeCm3: number, scalePercent: number): number {
  return volumeCm3 * (scalePercent / 100) ** 3;
}

/** Slicer infill the material's "infill %" setting is calibrated for. */
export const REFERENCE_INFILL_PERCENT = 25;

/**
 * A material's `infillPercent` is the share of the solid volume actually printed (walls + infill)
 * at the typical 25% slicer infill. The customer picks a slicer infill instead, so we model
 * share = walls + (100 − walls) × infill, with the walls part solved from the material setting:
 * e.g. 40% at 25% infill → walls 20% → 15% infill gives 32%, 50% → 60%, 100% → 100% (solid).
 */
export function effectiveFillShare(slicerInfillPercent: number, materialSharePercent: number): number {
  const reference = REFERENCE_INFILL_PERCENT / 100;
  const walls = Math.max(0, (materialSharePercent - REFERENCE_INFILL_PERCENT) / (1 - reference));
  return Math.min(100, walls + ((100 - walls) * slicerInfillPercent) / 100);
}
