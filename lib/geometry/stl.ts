import { TriangleAccumulator } from "./accumulator";
import { GeometryParseError, type GeometryStats } from "./types";

const HEADER_SIZE = 80;
const TRIANGLE_COUNT_SIZE = 4;
const BYTES_PER_TRIANGLE = 50; // 12 (normal) + 36 (3 vertices) + 2 (attribute byte count)

function isBinarySTL(buffer: Buffer): boolean {
  if (buffer.length < HEADER_SIZE + TRIANGLE_COUNT_SIZE) return false;

  const triangleCount = buffer.readUInt32LE(HEADER_SIZE);
  const expectedSize =
    HEADER_SIZE + TRIANGLE_COUNT_SIZE + triangleCount * BYTES_PER_TRIANGLE;

  if (expectedSize === buffer.length) return true;

  // Fall back to the ASCII heuristic only when the binary size check fails.
  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8");
  return !/^\s*solid\b/i.test(head);
}

function parseBinarySTL(buffer: Buffer): GeometryStats {
  const triangleCount = buffer.readUInt32LE(HEADER_SIZE);
  const acc = new TriangleAccumulator();
  let offset = HEADER_SIZE + TRIANGLE_COUNT_SIZE;

  for (let i = 0; i < triangleCount; i++) {
    offset += 12; // skip normal
    const ax = buffer.readFloatLE(offset);
    const ay = buffer.readFloatLE(offset + 4);
    const az = buffer.readFloatLE(offset + 8);
    const bx = buffer.readFloatLE(offset + 12);
    const by = buffer.readFloatLE(offset + 16);
    const bz = buffer.readFloatLE(offset + 20);
    const cx = buffer.readFloatLE(offset + 24);
    const cy = buffer.readFloatLE(offset + 28);
    const cz = buffer.readFloatLE(offset + 32);
    offset += 36 + 2;

    acc.addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz);
  }

  return acc.finish();
}

function parseAsciiSTL(text: string): GeometryStats {
  const acc = new TriangleAccumulator();
  const vertexRe = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  const matches = [...text.matchAll(vertexRe)].map((m) => [
    parseFloat(m[1]),
    parseFloat(m[2]),
    parseFloat(m[3]),
  ]);

  if (matches.length === 0 || matches.length % 3 !== 0) {
    throw new GeometryParseError("Malformed ASCII STL: vertex count is not a multiple of 3");
  }

  for (let i = 0; i < matches.length; i += 3) {
    const [ax, ay, az] = matches[i];
    const [bx, by, bz] = matches[i + 1];
    const [cx, cy, cz] = matches[i + 2];
    acc.addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz);
  }

  return acc.finish();
}

export function parseSTL(buffer: Buffer): GeometryStats {
  try {
    if (isBinarySTL(buffer)) {
      return parseBinarySTL(buffer);
    }
    return parseAsciiSTL(buffer.toString("utf8"));
  } catch (err) {
    if (err instanceof GeometryParseError) throw err;
    throw new GeometryParseError(
      `Failed to parse STL file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
