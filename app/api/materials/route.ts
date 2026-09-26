import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { resolvePricing } from "@/lib/pricing/defaults";
import { materialImageUrl } from "@/lib/types";

export async function GET() {
  const materials = await prisma.material.findMany({
    where: { active: true },
    include: { colors: true, finishes: true },
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
      colors: m.colors.map((c) => ({ id: c.id, name: c.name, nameRu: c.nameRu, hex: c.hex })),
      finishes: m.finishes.map((f) => ({
        id: f.id,
        name: f.name,
        nameRu: f.nameRu,
        multiplier: Number(f.multiplier),
      })),
    })),
  });
}
