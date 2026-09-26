import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { setSetting } from "@/lib/settings";

const SettingsSchema = z.object({
  minStockGrams: z.number().int().min(0).max(100_000).optional(),
});

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = SettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid values" }, { status: 400 });
  }

  if (parsed.data.minStockGrams !== undefined) {
    await setSetting("bambuddy.minStockGrams", String(parsed.data.minStockGrams));
  }
  return NextResponse.json({ ok: true });
}
