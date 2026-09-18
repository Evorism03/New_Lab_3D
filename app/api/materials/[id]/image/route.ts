import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const material = await prisma.material.findUnique({
    where: { id },
    select: { imageKey: true },
  });

  if (!material?.imageKey) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await storage.read(material.imageKey);
  const ext = material.imageKey.split(".").pop()?.toLowerCase() ?? "";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      // The URL carries the storage key as ?v=, so a new upload gets a new URL.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const material = await prisma.material.findUnique({
    where: { id },
    select: { imageKey: true },
  });
  if (!material) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(ext in CONTENT_TYPES)) {
    return NextResponse.json(
      { error: "Unsupported image format. Supported: JPG, PNG, WEBP" },
      { status: 400 },
    );
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json({ error: "Image too large (max 10MB)" }, { status: 400 });
  }

  const imageKey = await storage.save(Buffer.from(await file.arrayBuffer()), file.name);
  await prisma.material.update({ where: { id }, data: { imageKey } });
  if (material.imageKey) await storage.remove(material.imageKey);

  return NextResponse.json({ imageKey });
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const material = await prisma.material.findUnique({
    where: { id },
    select: { imageKey: true },
  });
  if (!material) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.material.update({ where: { id }, data: { imageKey: null } });
  if (material.imageKey) await storage.remove(material.imageKey);

  return NextResponse.json({ ok: true });
}
