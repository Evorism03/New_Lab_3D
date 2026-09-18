import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { stripe, stripeConfigured } from "@/lib/stripe";

const Schema = z.object({ orderId: z.string() });

export async function POST(request: NextRequest) {
  if (!stripeConfigured) {
    return NextResponse.json(
      { error: "Stripe is not configured on this server (missing STRIPE_SECRET_KEY)" },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: parsed.data.orderId },
    include: { items: { include: { material: true, finish: true } } },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "AWAITING_PAYMENT") {
    return NextResponse.json({ error: "Order is not awaiting payment" }, { status: 400 });
  }

  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: order.email ?? undefined,
    line_items: order.items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: "rub",
        unit_amount: item.unitPriceCents,
        product_data: {
          name: `${item.material.name}${item.finish ? ` — ${item.finish.name}` : ""}`,
        },
      },
    })),
    metadata: { orderId: order.id },
    success_url: `${appUrl}/order/${order.id}/status?checkout=success`,
    cancel_url: `${appUrl}/order/checkout?orderId=${order.id}&checkout=cancelled`,
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { stripeSessionId: checkoutSession.id },
  });

  return NextResponse.json({ url: checkoutSession.url });
}
