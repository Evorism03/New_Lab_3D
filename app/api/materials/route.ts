import { NextResponse } from "next/server";

import { availableCatalog } from "@/lib/colorSync";
import { prisma } from "@/lib/db";
import { resolvePricing } from "@/lib/pricing/defaults";
import { COLOR_ORDER, materialImageUrl } from "@/lib/types";

export async function GET() {
  const available = await availableCatalog();
  const materials = await prisma.material.findMany({
    where: available.materials,
    include: { colors: { where: available.colors, orderBy: COLOR_ORDER }, finishes: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    materials: materials.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      description: m.description,
      ...resolvePricing(m),
      setupFeeCents: m.setupFeeCents,
      minPriceCents: m.minPriceCents,
      leadTimeDays: m.leadTimeDays,
      strength: m.strength,
      flexibility: m.flexibility,
      heatResistance: m.heatResistance,
      bestFor: m.bestFor,
      imageUrl: materialImageUrl(m.id, m.imageKey),
      colors: m.colors.map((c) => ({ id: c.id, name: c.name, nameRu: c.nameRu, hex: c.hex, variant: c.variant })),
      finishes: m.finishes.map((f) => ({
        id: f.id,
        name: f.name,
        nameRu: f.nameRu,
        multiplier: Number(f.multiplier),
      })),
    })),
  });
}
