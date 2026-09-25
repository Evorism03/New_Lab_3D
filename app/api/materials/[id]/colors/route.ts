import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { colorNameEn } from "@/lib/i18n/colorNames";

// The admin enters the Russian name only; the English one is derived from it.
const ColorSchema = z.object({
  nameRu: z.string().trim().min(1).max(40),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = ColorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid values" }, { status: 400 });
  }

  const material = await prisma.material.findUnique({ where: { id }, select: { id: true } });
  if (!material) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { nameRu, hex } = parsed.data;
  const name = colorNameEn(nameRu);
  const duplicate = await prisma.color.findUnique({
    where: { materialId_name: { materialId: id, name } },
    select: { id: true },
  });
  if (duplicate) {
    return NextResponse.json({ error: "Color with this name already exists" }, { status: 409 });
  }

  const color = await prisma.color.create({
    data: { materialId: id, name, nameRu, hex: hex.toLowerCase() },
  });
  return NextResponse.json(
    { color: { id: color.id, name: color.name, nameRu: color.nameRu, hex: color.hex } },
    { status: 201 },
  );
}
