import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { BambuddyError, listPrinters } from "@/lib/bambuddy";

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return NextResponse.json({ printers: await listPrinters() });
  } catch (err) {
    const status = err instanceof BambuddyError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status });
  }
}
