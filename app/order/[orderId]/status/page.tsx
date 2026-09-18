import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/StatusBadge";
import { prisma } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";
import { serializeOrder } from "@/lib/serializers";
import { formatCents } from "@/lib/types";

export default async function OrderStatusPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const dict = getDictionary(await getServerLocale());
  const t = dict.orderStatus;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { file: true, material: true, color: true, finish: true } } },
  });

  if (!order) notFound();

  const dto = serializeOrder(order);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-medium text-accent">
        {t.orderPrefix} #{dto.id.slice(-8)}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <StatusBadge status={dto.status} label={t.status[dto.status as keyof typeof t.status] ?? dto.status} />
        <span className="text-sm text-muted">
          {t.placed} {new Date(dto.createdAt).toLocaleDateString()}
        </span>
      </div>

      <div className="card mt-8 divide-y divide-border">
        {dto.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium text-text">{item.file.originalName}</p>
              <p className="text-sm text-muted">
                {item.material.name}
                {item.color ? ` · ${item.color.name}` : ""}
                {item.finish ? ` · ${item.finish.name}` : ""} · {t.qty} {item.quantity}
                {item.file.volumeCm3 !== null ? ` · ${item.file.volumeCm3.toFixed(2)} cm³` : ""}
              </p>
            </div>
            <p className="font-medium text-text">{formatCents(item.totalPriceCents)}</p>
          </div>
        ))}
        <div className="flex items-center justify-between p-4">
          <p className="font-semibold text-text">{t.total}</p>
          <p className="font-semibold text-text">{formatCents(dto.totalCents)}</p>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="font-semibold text-text">{t.shippingTo}</h2>
        <p className="mt-1 text-sm text-muted">
          {dto.shipping.name}
          <br />
          {dto.shipping.address}
          <br />
          {dto.shipping.city}, {dto.shipping.postal}
          <br />
          {dto.shipping.country}
        </p>
      </div>
    </div>
  );
}
