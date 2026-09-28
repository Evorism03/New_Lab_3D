import { NextRequest, NextResponse } from "next/server";

import { suggestAddress, type AddressLevel } from "@/lib/addressSuggest";

const LEVELS = new Set<AddressLevel>(["city", "street", "house"]);

// Checkout dropdowns: GET ?level=city|street|house&q=…, plus the previous choice
// (cityId/cityName/bbox for streets, streetId/streetName for houses).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const level = params.get("level") as AddressLevel;
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  // Houses are often a single digit; cities and streets need a couple of letters to mean anything.
  if (!LEVELS.has(level) || q.length < (level === "house" ? 1 : 2)) {
    return NextResponse.json({ suggestions: [] });
  }

  const ctx = {
    cityId: params.get("cityId") ?? undefined,
    cityName: params.get("cityName") ?? undefined,
    bbox: params.get("bbox") ?? undefined,
    streetId: params.get("streetId") ?? undefined,
    streetName: params.get("streetName") ?? undefined,
  };
  return NextResponse.json({ suggestions: await suggestAddress(level, q, ctx) });
}
