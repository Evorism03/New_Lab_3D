import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { serializeFile } from "@/lib/serializers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const file = await prisma.uploadedFile.findUnique({ where: { id } });

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  return NextResponse.json({ file: serializeFile(file) });
}
