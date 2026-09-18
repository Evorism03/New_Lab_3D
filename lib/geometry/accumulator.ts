import type { GeometryStats } from "./types";

/**
 * Accumulates bounding box and signed volume (via the divergence theorem —
 * sum of signed tetrahedra formed by each triangle and the origin) across a
 * stream of triangles, without holding the whole mesh in memory twice.
 */
export class TriangleAccumulator {
  private minX = Infinity;
  private minY = Infinity;
  private minZ = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  private maxZ = -Infinity;
  private signedVolumeMm3 = 0;
  private count = 0;

  addTriangle(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
  ) {
    this.minX = Math.min(this.minX, ax, bx, cx);
    this.minY = Math.min(this.minY, ay, by, cy);
    this.minZ = Math.min(this.minZ, az, bz, cz);
    this.maxX = Math.max(this.maxX, ax, bx, cx);
    this.maxY = Math.max(this.maxY, ay, by, cy);
    this.maxZ = Math.max(this.maxZ, az, bz, cz);

    // signed volume of tetrahedron (origin, a, b, c) = a . (b x c) / 6
    this.signedVolumeMm3 +=
      (ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx)) /
      6;

    this.count += 1;
  }

  finish(): GeometryStats {
    if (this.count === 0) {
      throw new Error("Mesh has no triangles");
    }
    return {
      volumeCm3: Math.abs(this.signedVolumeMm3) / 1000,
      bboxMm: {
        x: this.maxX - this.minX,
        y: this.maxY - this.minY,
        z: this.maxZ - this.minZ,
      },
      triangleCount: this.count,
    };
  }
}
