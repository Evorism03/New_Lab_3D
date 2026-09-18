import { NextRequest, NextResponse } from "next/server";

import { analyzeGeometry, detectFormat, GeometryParseError } from "@/lib/geometry";
import { prisma } from "@/lib/db";
import { serializeFile } from "@/lib/serializers";
import { storage } from "@/lib/storage";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const format = detectFormat(file.name);
  if (!format) {
    return NextResponse.json(
      { error: "Unsupported file format. Supported: STL, OBJ" },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storageKey = await storage.save(buffer, file.name);

  const uploadedFile = await prisma.uploadedFile.create({
    data: {
      storageKey,
      originalName: file.name,
      format,
      sizeBytes: file.size,
      status: "ANALYZING",
    },
  });

  try {
    const stats = analyzeGeometry(buffer, format);
    const updated = await prisma.uploadedFile.update({
      where: { id: uploadedFile.id },
      data: {
        status: "READY",
        volumeCm3: stats.volumeCm3,
        bboxXMm: stats.bboxMm.x,
        bboxYMm: stats.bboxMm.y,
        bboxZMm: stats.bboxMm.z,
        triangleCount: stats.triangleCount,
      },
    });
    return NextResponse.json({ file: serializeFile(updated) }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof GeometryParseError ? err.message : "Failed to analyze geometry";
    const updated = await prisma.uploadedFile.update({
      where: { id: uploadedFile.id },
      data: { status: "ERROR", errorMessage: message },
    });
    return NextResponse.json({ file: serializeFile(updated) }, { status: 422 });
  }
}
