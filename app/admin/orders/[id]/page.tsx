import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/StatusBadge";
import { StatusControl } from "@/components/StatusControl";
import { prisma } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";
import { serializeOrder } from "@/lib/serializers";
import { formatCents } from "@/lib/money";

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dict = getDictionary(await getServerLocale());
  const t = dict.admin;
  const statusLabels = dict.orderStatus.status;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { include: { file: true, material: true, color: true, finish: true } } },
  });

  if (!order) notFound();

  const dto = serializeOrder(order);

  return (
    <div>
      <p className="text-sm font-medium text-accent">
        {t.colOrder} #{dto.id.slice(-8)}
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
        <StatusBadge status={dto.status} label={statusLabels[dto.status as keyof typeof statusLabels] ?? dto.status} />
        <StatusControl orderId={dto.id} currentStatus={dto.status} dict={dict} />
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-muted">
        <div>
          <dt className="inline font-medium text-text">{t.placedOn}: </dt>
          <dd className="inline">{new Date(dto.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-text">{t.updatedOn}: </dt>
          <dd className="inline">{new Date(dto.updatedAt).toLocaleString()}</dd>
        </div>
      </dl>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <h2 className="font-semibold text-text">{t.itemsTitle}</h2>
          <div className="card mt-2 divide-y divide-border">
            {dto.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-4">
                <div>
                  <a
                    href={`/api/files/${item.file.id}/raw`}
                    className="font-medium text-accent hover:underline"
                    download
                  >
                    {item.file.originalName}
                  </a>
                  <p className="text-sm text-muted">
                    {item.material.name}
                    {item.color ? ` · ${item.color.name}` : ""}
                    {item.finish ? ` · ${item.finish.name}` : ""} · {dict.orderStatus.qty} {item.quantity}
                    {item.file.volumeCm3 !== null ? ` · ${item.file.volumeCm3.toFixed(2)} ${dict.units.cm3}` : ""}
                    {` · ${item.file.format}`}
                  </p>
                </div>
                <p className="font-medium text-text">{formatCents(item.totalPriceCents, dict.locale)}</p>
              </div>
            ))}
            <div className="flex items-center justify-between p-4">
              <p className="font-semibold text-text">{dict.orderStatus.total}</p>
              <p className="font-semibold text-text">{formatCents(dto.totalCents, dict.locale)}</p>
            </div>
          </div>
        </div>

        <div>
          <h2 className="font-semibold text-text">{t.customerTitle}</h2>
          <div className="card mt-2 p-4 text-sm text-muted">
            <p>{dto.email ?? t.noEmail}</p>
            {dto.shipping.address ? (
              <>
                <p className="mt-2">{dto.shipping.name}</p>
                <p>{dto.shipping.address}</p>
                <p>
                  {dto.shipping.city}, {dto.shipping.postal}
                </p>
                <p>{dto.shipping.country}</p>
              </>
            ) : (
              <p className="mt-2">{t.noAddress}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
