import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const file = await prisma.uploadedFile.findUnique({ where: { id } });

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const buffer = await storage.read(file.storageKey);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalName)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
