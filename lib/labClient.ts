import type { OrderDTO } from "@/lib/types";

// lab (D:\GitHub\lab) is the fulfillment/shipping tool — every paid order ends up there.
// Its own frontend talks to /api/orders without auth; this machine-to-machine channel
// (/api/external/orders) is separate and optionally protected by LAB_API_KEY.
const LAB_API_URL = process.env.LAB_API_URL;
const LAB_API_KEY = process.env.LAB_API_KEY;
const REQUEST_TIMEOUT_MS = 5000;

// Same fallback chain as app/api/checkout/session/route.ts — used to build an absolute,
// publicly reachable link to the uploaded model so lab staff can download it directly.
const APP_URL = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function authHeaders(): Record<string, string> {
  return LAB_API_KEY ? { Authorization: `Bearer ${LAB_API_KEY}` } : {};
}

async function callLab(path: string, init: RequestInit): Promise<void> {
  if (!LAB_API_URL) {
    console.error(`[labClient] LAB_API_URL is not configured, skipping ${path}`);
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${LAB_API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...authHeaders(), ...init.headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[labClient] ${path} failed: ${res.status} ${body}`);
    }
  } catch (err) {
    console.error(`[labClient] ${path} failed:`, err instanceof Error ? err.message : err);
  } finally {
    clearTimeout(timeout);
  }
}

function formatShippingAddress(shipping: OrderDTO["shipping"]): string {
  return [shipping.address, shipping.city, shipping.postal, shipping.country].filter(Boolean).join(", ");
}

// lab has no concept of files/materials/finishes — 3D-print items go in as free text
// (item_kind: "print") instead of the model/color/connector catalog used for the one
// physical product lab was originally built for.
function toLabPayload(order: OrderDTO) {
  return {
    external_order_id: order.id,
    customer_email: order.email,
    full_name: order.shipping.name,
    shipping_address: formatShippingAddress(order.shipping),
    payment_status: "unpaid",
    items: order.items.map((item) => ({
      item_kind: "print",
      product_name: item.material.name + (item.finish ? ` — ${item.finish.name}` : ""),
      material: item.material.name,
      finish: item.finish?.name ?? null,
      color: item.color?.name ?? null,
      source_file: item.file.originalName,
      source_file_url: `${APP_URL}/api/files/${item.file.id}/raw`,
      quantity: item.quantity,
      price: item.unitPriceCents / 100,
      external_ref: item.id,
    })),
  };
}

/** Fire-and-forget: lab being unreachable must never block checkout/payment. */
export async function pushOrderToLab(order: OrderDTO): Promise<void> {
  await callLab("/api/external/orders", {
    method: "POST",
    body: JSON.stringify(toLabPayload(order)),
  });
}

export async function markOrderPaidInLab(orderId: string): Promise<void> {
  await callLab(`/api/external/orders/${encodeURIComponent(orderId)}/payment`, {
    method: "PATCH",
  });
}
