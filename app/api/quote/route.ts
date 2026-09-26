import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { availableCatalog } from "@/lib/colorSync";
import { prisma } from "@/lib/db";
import { PricingError } from "@/lib/pricing/engine";
import { computeMaterialPrice } from "@/lib/pricing/material";
import { MAX_SCALE_PERCENT, MIN_SCALE_PERCENT, scaledVolume } from "@/lib/pricing/options";
import { getInfillOptions } from "@/lib/settings";

const QuoteSchema = z.object({
  fileId: z.string(),
  materialId: z.string(),
  finishId: z.string().optional(),
  colorId: z.string().optional(),
  quantity: z.number().int().min(1).max(1000).default(1),
  scalePercent: z.number().int().min(MIN_SCALE_PERCENT).max(MAX_SCALE_PERCENT).default(100),
  // Must be one of the admin's infill levels; omitted = the default level.
  infillPercent: z.number().int().min(1).max(100).optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = QuoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { fileId, materialId, finishId, colorId, quantity, scalePercent } = parsed.data;

  const infill = await getInfillOptions();
  const infillPercent = parsed.data.infillPercent ?? infill.defaultLevel;
  if (!infill.levels.includes(infillPercent)) {
    return NextResponse.json({ error: "Infill level is not available" }, { status: 400 });
  }

  const available = await availableCatalog();
  // Once colors come from the Bambuddy inventory, a color is required — it is what we have in stock.
  const colorRequired = Object.keys(available.colors).length > 0;
  const [file, material, finish, color] = await Promise.all([
    prisma.uploadedFile.findUnique({ where: { id: fileId } }),
    prisma.material.findFirst({ where: { id: materialId, ...available.materials } }),
    finishId ? prisma.finish.findUnique({ where: { id: finishId } }) : Promise.resolve(null),
    colorId ? prisma.color.findFirst({ where: { id: colorId, ...available.colors } }) : Promise.resolve(null),
  ]);

  if (!file || file.status !== "READY" || file.volumeCm3 === null) {
    return NextResponse.json({ error: "File is not ready for quoting" }, { status: 400 });
  }
  if (!material) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }
  if (finishId && (!finish || finish.materialId !== material.id)) {
    return NextResponse.json({ error: "Finish does not belong to this material" }, { status: 400 });
  }
  if ((colorId || colorRequired) && (!color || color.materialId !== material.id)) {
    return NextResponse.json({ error: "Color is not available for this material" }, { status: 400 });
  }

  try {
    const breakdown = computeMaterialPrice(
      material,
      {
        volumeCm3: scaledVolume(Number(file.volumeCm3), scalePercent),
        finishMultiplier: finish ? Number(finish.multiplier) : 1,
        quantity,
        infillPercent,
      },
      color,
    );

    return NextResponse.json({
      quote: {
        ...breakdown,
        currency: "rub",
        leadTimeDays: material.leadTimeDays,
      },
    });
  } catch (err) {
    if (err instanceof PricingError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
