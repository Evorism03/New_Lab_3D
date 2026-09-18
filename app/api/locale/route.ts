import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { LOCALE_COOKIE } from "@/lib/i18n/locale";
import { LOCALES } from "@/lib/i18n/translations";

const Schema = z.object({ locale: z.enum(LOCALES) });

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }

  const store = await cookies();
  store.set(LOCALE_COOKIE, parsed.data.locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  return NextResponse.json({ locale: parsed.data.locale });
}
