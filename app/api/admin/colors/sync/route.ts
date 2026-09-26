import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { BambuddyError, isBambuddyConfigured } from "@/lib/bambuddy";
import { syncColorsFromBambuddy } from "@/lib/colorSync";

// "Sync now" in the admin; the site also re-syncs on its own every few minutes.
export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isBambuddyConfigured()) {
    return NextResponse.json({ error: "BAMBUDDY_API_KEY is not configured" }, { status: 503 });
  }

  try {
    return NextResponse.json({ result: await syncColorsFromBambuddy() });
  } catch (err) {
    const status = err instanceof BambuddyError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status });
  }
}
