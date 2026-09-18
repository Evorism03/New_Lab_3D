import { parseOBJ } from "./obj";
import { parseSTL } from "./stl";
import { GeometryParseError, type GeometryStats } from "./types";

export type { GeometryStats };
export { GeometryParseError };

export const SUPPORTED_FORMATS = ["STL", "OBJ"] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

export function detectFormat(filename: string): SupportedFormat | null {
  const ext = filename.split(".").pop()?.toUpperCase();
  if (ext === "STL" || ext === "OBJ") return ext;
  return null;
}

export function analyzeGeometry(buffer: Buffer, format: SupportedFormat): GeometryStats {
  switch (format) {
    case "STL":
      return parseSTL(buffer);
    case "OBJ":
      return parseOBJ(buffer);
  }
}
