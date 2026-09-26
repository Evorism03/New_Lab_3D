export type FileDTO = {
  id: string;
  originalName: string;
  format: "STL" | "OBJ";
  sizeBytes: number;
  status: "ANALYZING" | "READY" | "ERROR";
  errorMessage: string | null;
  volumeCm3: number | null;
  bboxMm: { x: number; y: number; z: number } | null;
  triangleCount: number | null;
  createdAt: string;
};

export type ColorDTO = { id: string; name: string; hex: string };
export type FinishDTO = { id: string; name: string; multiplier: number };

export type MaterialDTO = {
  id: string;
  name: string;
  description: string | null;
  /** Printer time, kopecks per hour. */
  hourlyRateCents: number;
  setupFeeCents: number;
  minPriceCents: number;
  leadTimeDays: number;
  strength: number;
  flexibility: number;
  heatResistance: number;
  bestFor: string | null;
  imageUrl: string | null;
  colors: ColorDTO[];
  finishes: FinishDTO[];
};

/** Public URL of a material's illustration; the key doubles as a cache-buster. */
export function materialImageUrl(id: string, imageKey: string | null): string | null {
  return imageKey ? `/api/materials/${id}/image?v=${encodeURIComponent(imageKey)}` : null;
}

export type QuoteDTO = {
  /** Estimated printing time of the whole order (hours) and plastic use (grams). */
  printHoursTotal: number;
  plasticGramsTotal: number;
  unitPriceCents: number;
  totalPriceCents: number;
  materialCostCents: number;
  setupFeeCents: number;
  minPriceFloorApplied: boolean;
  currency: string;
  leadTimeDays: number;
};

export type OrderItemDTO = {
  id: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  file: { id: string; originalName: string; format: "STL" | "OBJ"; volumeCm3: number | null };
  material: { id: string; name: string };
  color: { id: string; name: string; nameRu: string | null } | null;
  finish: { id: string; name: string; nameRu: string | null } | null;
};

export type OrderDTO = {
  id: string;
  status: string;
  email: string | null;
  shipping: {
    name: string | null;
    address: string | null;
    city: string | null;
    postal: string | null;
    country: string | null;
  };
  totalCents: number;
  items: OrderItemDTO[];
  createdAt: string;
  updatedAt: string;
};
