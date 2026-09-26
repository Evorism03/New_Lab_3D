import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { BambuddyError, controlPrinter, PRINTER_ACTIONS, type PrinterAction } from "@/lib/bambuddy";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, action } = await params;
  const printerId = Number(id);
  if (!Number.isInteger(printerId) || !PRINTER_ACTIONS.includes(action as PrinterAction)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await controlPrinter(printerId, action as PrinterAction);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof BambuddyError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status });
  }
}
