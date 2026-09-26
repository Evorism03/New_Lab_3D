import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { setSetting } from "@/lib/settings";

const SettingsSchema = z
  .object({
    minStockGrams: z.number().int().min(0).max(100_000).optional(),
    infillLevels: z.array(z.number().int().min(1).max(100)).min(1).max(10).optional(),
    defaultInfill: z.number().int().min(1).max(100).optional(),
  })
  // The default must be one of the levels offered to customers.
  .refine((v) => v.defaultInfill === undefined || !v.infillLevels || v.infillLevels.includes(v.defaultInfill));

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
  if (parsed.data.infillLevels !== undefined) {
    const levels = [...new Set(parsed.data.infillLevels)].sort((a, b) => a - b);
    await setSetting("order.infillLevels", levels.join(","));
  }
  if (parsed.data.defaultInfill !== undefined) {
    await setSetting("order.defaultInfill", String(parsed.data.defaultInfill));
  }
  return NextResponse.json({ ok: true });
}
