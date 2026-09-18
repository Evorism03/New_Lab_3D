import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { OrderStatus } from "@/lib/generated/prisma/client";
import { serializeOrder } from "@/lib/serializers";

const OrderStatusValues = Object.values(OrderStatus) as [string, ...string[]];
const PatchSchema = z.object({ status: z.enum(OrderStatusValues) });

const ORDER_INCLUDE = {
  items: { include: { file: true, material: true, color: true, finish: true } },
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({ order: serializeOrder(order) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const order = await prisma.order.update({
    where: { id },
    data: { status: parsed.data.status as OrderStatus },
    include: ORDER_INCLUDE,
  });

  return NextResponse.json({ order: serializeOrder(order) });
}
