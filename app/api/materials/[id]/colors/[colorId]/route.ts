import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { colorNameEn } from "@/lib/i18n/colorNames";

const PatchSchema = z.object({
  nameRu: z.string().trim().min(1).max(40).optional(),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  // Kopecks; null goes back to the material's spool price.
  spoolPriceCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
});

async function findOwnColor(materialId: string, colorId: string) {
  return prisma.color.findFirst({ where: { id: colorId, materialId } });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; colorId: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, colorId } = await params;
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid values" }, { status: 400 });
  }

  const existing = await findOwnColor(id, colorId);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { nameRu, hex, spoolPriceCents } = parsed.data;
  // Renaming re-derives the English name from the new Russian one.
  const name = nameRu !== undefined ? colorNameEn(nameRu) : undefined;
  if (name && name !== existing.name) {
    const duplicate = await prisma.color.findUnique({
      where: { materialId_variant_name: { materialId: id, variant: existing.variant, name } },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json({ error: "Color with this name already exists" }, { status: 409 });
    }
  }

  const color = await prisma.color.update({
    where: { id: colorId },
    data: {
      ...(name !== undefined ? { name, nameRu } : {}),
      ...(hex !== undefined ? { hex: hex.toLowerCase() } : {}),
      ...(spoolPriceCents !== undefined ? { spoolPriceCents } : {}),
    },
  });
  return NextResponse.json({
    color: { id: color.id, name: color.name, nameRu: color.nameRu, hex: color.hex },
  });
}

// Past orders keep working: OrderItem.colorId is set to NULL when its color is deleted.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; colorId: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, colorId } = await params;
  const existing = await findOwnColor(id, colorId);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.color.delete({ where: { id: colorId } });
  return NextResponse.json({ ok: true });
}
