import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";

const PricingSchema = z.object({
  pricePerCm3: z.number().min(0).max(10000).optional(),
  setupFeeCents: z.number().int().min(0).max(100_000_000).optional(),
  minPriceCents: z.number().int().min(0).max(100_000_000).optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  active: z.boolean().optional(),
  finishes: z
    .array(z.object({ id: z.string(), multiplier: z.number().min(0.01).max(100) }))
    .optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = PricingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid values" }, { status: 400 });
  }
  const { finishes, ...materialData } = parsed.data;

  const material = await prisma.material.findUnique({
    where: { id },
    include: { finishes: { select: { id: true } } },
  });
  if (!material) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ownFinishIds = new Set(material.finishes.map((f) => f.id));
  if (finishes?.some((f) => !ownFinishIds.has(f.id))) {
    return NextResponse.json({ error: "Finish does not belong to this material" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.material.update({ where: { id }, data: materialData }),
    ...(finishes ?? []).map((f) =>
      prisma.finish.update({ where: { id: f.id }, data: { multiplier: f.multiplier } }),
    ),
  ]);

  return NextResponse.json({ ok: true });
}
