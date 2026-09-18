// Single source of truth for the hero's rotated parallax shape geometry —
// shared by TiltFrame (which renders it) and TextMask (which clips a dark
// text layer to wherever it overlaps), so the two can never drift apart.
export const HERO_ROTATE_DEG = -18;
export const HERO_PARALLAX_FACTOR = 0.35;

export function heroShapeTransform(scrollY: number): string {
  return `translateY(${scrollY * HERO_PARALLAX_FACTOR}px) rotate(${HERO_ROTATE_DEG}deg)`;
}

/** The shape's four corners in viewport space, for a given scroll position. */
export function heroShapeCorners(
  scrollY: number,
  viewportWidth: number,
  viewportHeight: number,
): [number, number][] {
  const x0 = -0.2 * viewportWidth;
  const y0 = -0.12 * viewportHeight;
  const w = 1.4 * viewportWidth;
  const h = 0.6 * viewportHeight;
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const theta = (HERO_ROTATE_DEG * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const ty = scrollY * HERO_PARALLAX_FACTOR;

  const localCorners: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];

  return localCorners.map(([x, y]) => {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    return [cx + rx, cy + ry + ty];
  });
}
