import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { computePrice, PricingError } from "@/lib/pricing/engine";

const QuoteSchema = z.object({
  fileId: z.string(),
  materialId: z.string(),
  finishId: z.string().optional(),
  colorId: z.string().optional(),
  quantity: z.number().int().min(1).max(1000).default(1),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = QuoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { fileId, materialId, finishId, colorId, quantity } = parsed.data;

  const [file, material, finish, color] = await Promise.all([
    prisma.uploadedFile.findUnique({ where: { id: fileId } }),
    prisma.material.findUnique({ where: { id: materialId } }),
    finishId ? prisma.finish.findUnique({ where: { id: finishId } }) : Promise.resolve(null),
    colorId ? prisma.color.findUnique({ where: { id: colorId } }) : Promise.resolve(null),
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
  if (colorId && (!color || color.materialId !== material.id)) {
    return NextResponse.json({ error: "Color does not belong to this material" }, { status: 400 });
  }

  try {
    const breakdown = computePrice({
      volumeCm3: Number(file.volumeCm3),
      pricePerCm3: Number(material.pricePerCm3),
      setupFeeCents: material.setupFeeCents,
      minPriceCents: material.minPriceCents,
      finishMultiplier: finish ? Number(finish.multiplier) : 1,
      quantity,
    });

    return NextResponse.json({
      quote: {
        ...breakdown,
        currency: "usd",
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
