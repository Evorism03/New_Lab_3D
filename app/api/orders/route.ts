import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { OrderStatus } from "@/lib/generated/prisma/client";
import { computePrice, PricingError } from "@/lib/pricing/engine";
import { serializeOrder } from "@/lib/serializers";

const OrderStatusValues = Object.values(OrderStatus) as [string, ...string[]];

const OrderItemSchema = z.object({
  fileId: z.string(),
  materialId: z.string(),
  finishId: z.string().optional(),
  colorId: z.string().optional(),
  quantity: z.number().int().min(1).max(1000).default(1),
});

const CreateOrderSchema = z.object({
  items: z.array(OrderItemSchema).min(1),
  email: z.string().email(),
  shipping: z.object({
    name: z.string().min(1),
    address: z.string().min(1),
    city: z.string().min(1),
    postal: z.string().min(1),
    country: z.string().min(1),
  }),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = CreateOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { items, email, shipping } = parsed.data;
  const session = await auth();

  const resolvedItems: {
    fileId: string;
    materialId: string;
    finishId: string | null;
    colorId: string | null;
    quantity: number;
    unitPriceCents: number;
    totalPriceCents: number;
  }[] = [];

  for (const item of items) {
    const [file, material, finish, color] = await Promise.all([
      prisma.uploadedFile.findUnique({ where: { id: item.fileId } }),
      prisma.material.findUnique({ where: { id: item.materialId } }),
      item.finishId ? prisma.finish.findUnique({ where: { id: item.finishId } }) : null,
      item.colorId ? prisma.color.findUnique({ where: { id: item.colorId } }) : null,
    ]);

    if (!file || file.status !== "READY" || file.volumeCm3 === null) {
      return NextResponse.json({ error: `File ${item.fileId} is not ready` }, { status: 400 });
    }
    if (!material) {
      return NextResponse.json({ error: `Material ${item.materialId} not found` }, { status: 404 });
    }

    try {
      const breakdown = computePrice({
        volumeCm3: Number(file.volumeCm3),
        pricePerCm3: Number(material.pricePerCm3),
        setupFeeCents: material.setupFeeCents,
        minPriceCents: material.minPriceCents,
        finishMultiplier: finish ? Number(finish.multiplier) : 1,
        quantity: item.quantity,
      });

      resolvedItems.push({
        fileId: file.id,
        materialId: material.id,
        finishId: finish?.id ?? null,
        colorId: color?.id ?? null,
        quantity: item.quantity,
        unitPriceCents: breakdown.unitPriceCents,
        totalPriceCents: breakdown.totalPriceCents,
      });
    } catch (err) {
      if (err instanceof PricingError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  const totalCents = resolvedItems.reduce((sum, i) => sum + i.totalPriceCents, 0);

  const order = await prisma.order.create({
    data: {
      userId: session?.user?.id,
      status: "AWAITING_PAYMENT",
      email,
      shippingName: shipping.name,
      shippingAddress: shipping.address,
      shippingCity: shipping.city,
      shippingPostal: shipping.postal,
      shippingCountry: shipping.country,
      totalCents,
      items: { create: resolvedItems },
    },
    include: { items: { include: { file: true, material: true, color: true, finish: true } } },
  });

  return NextResponse.json({ order: serializeOrder(order) }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const limit = Math.min(Number(searchParams.get("limit") ?? 25), 100);
  const cursor = searchParams.get("cursor");

  const statusResult = statusParam ? z.enum(OrderStatusValues).safeParse(statusParam) : null;
  if (statusParam && !statusResult?.success) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const orders = await prisma.order.findMany({
    where: statusResult?.data ? { status: statusResult.data as OrderStatus } : undefined,
    include: { items: { include: { file: true, material: true, color: true, finish: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  return NextResponse.json({
    orders: orders.map(serializeOrder),
    nextCursor: orders.length === limit ? orders[orders.length - 1].id : null,
  });
}
