import { TriangleAccumulator } from "./accumulator";
import { GeometryParseError, type GeometryStats } from "./types";

function resolveIndex(raw: number, vertexCount: number): number {
  // OBJ indices are 1-based; negative indices are relative to the current end of the vertex list.
  return raw > 0 ? raw - 1 : vertexCount + raw;
}

export function parseOBJ(buffer: Buffer): GeometryStats {
  const text = buffer.toString("utf8");
  const vertices: number[][] = [];
  const acc = new TriangleAccumulator();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    if (line.startsWith("v ") || line === "v") {
      const parts = line.split(/\s+/).slice(1);
      const [x, y, z] = parts.map(Number);
      if ([x, y, z].some((n) => Number.isNaN(n))) {
        throw new GeometryParseError(`Malformed vertex line: "${line}"`);
      }
      vertices.push([x, y, z]);
      continue;
    }

    if (line.startsWith("f ") || line === "f") {
      const tokens = line.split(/\s+/).slice(1);
      const faceIndices = tokens.map((tok) => {
        const vIndexRaw = parseInt(tok.split("/")[0], 10);
        const idx = resolveIndex(vIndexRaw, vertices.length);
        if (idx < 0 || idx >= vertices.length) {
          throw new GeometryParseError(`Face references out-of-range vertex in line: "${line}"`);
        }
        return idx;
      });

      // Fan-triangulate polygons (OBJ faces may have 3+ vertices).
      for (let i = 1; i < faceIndices.length - 1; i++) {
        const [ax, ay, az] = vertices[faceIndices[0]];
        const [bx, by, bz] = vertices[faceIndices[i]];
        const [cx, cy, cz] = vertices[faceIndices[i + 1]];
        acc.addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz);
      }
    }
  }

  try {
    return acc.finish();
  } catch {
    throw new GeometryParseError("OBJ file contains no faces");
  }
}
