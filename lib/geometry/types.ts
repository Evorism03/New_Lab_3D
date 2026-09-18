export type GeometryStats = {
  volumeCm3: number;
  bboxMm: { x: number; y: number; z: number };
  triangleCount: number;
};

export class GeometryParseError extends Error {}
