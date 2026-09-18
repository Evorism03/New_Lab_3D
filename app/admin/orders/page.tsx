import Link from "next/link";

import { StatusBadge } from "@/components/StatusBadge";
import { prisma } from "@/lib/db";
import { OrderStatus } from "@/lib/generated/prisma/client";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";
import { serializeOrder } from "@/lib/serializers";
import { formatCents } from "@/lib/types";

const STATUSES = Object.values(OrderStatus);

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const dict = getDictionary(await getServerLocale());
  const t = dict.admin;
  const statusLabels = dict.orderStatus.status;

  const orders = await prisma.order.findMany({
    where: status ? { status: status as OrderStatus } : { status: { not: "DRAFT" } },
    include: { items: { include: { file: true, material: true, color: true, finish: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const dtos = orders.map(serializeOrder);

  return (
    <div>
      <h1 className="text-2xl font-bold text-text">{t.ordersTitle}</h1>

      <form className="mt-4 flex items-center gap-2" method="get">
        <select name="status" defaultValue={status ?? ""} className="px-3 py-1.5 text-sm">
          <option value="">{t.filterAll}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabels[s as keyof typeof statusLabels] ?? s}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-outline px-3 py-1.5 text-sm">
          {t.filterButton}
        </button>
      </form>

      <div className="card mt-6 overflow-hidden overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-soft text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">{t.colOrder}</th>
              <th className="px-4 py-2 font-medium">{t.colStatus}</th>
              <th className="px-4 py-2 font-medium">{t.colCustomer}</th>
              <th className="px-4 py-2 font-medium">{t.colMaterials}</th>
              <th className="px-4 py-2 font-medium">{t.colDestination}</th>
              <th className="px-4 py-2 font-medium">{t.colItems}</th>
              <th className="px-4 py-2 font-medium">{t.colTotal}</th>
              <th className="px-4 py-2 font-medium">{t.colPlaced}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {dtos.map((order) => {
              const materials = [...new Set(order.items.map((i) => i.material.name))].join(", ");
              const destination = [order.shipping.city, order.shipping.country]
                .filter(Boolean)
                .join(", ");
              const itemCount = order.items.reduce((sum, i) => sum + i.quantity, 0);

              return (
                <tr key={order.id}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/orders/${order.id}`} className="font-medium text-accent">
                      #{order.id.slice(-8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      status={order.status}
                      label={statusLabels[order.status as keyof typeof statusLabels] ?? order.status}
                    />
                  </td>
                  <td className="px-4 py-3 text-muted">{order.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{materials || "—"}</td>
                  <td className="px-4 py-3 text-muted">{destination || "—"}</td>
                  <td className="px-4 py-3 text-muted">{itemCount}</td>
                  <td className="px-4 py-3 text-text">{formatCents(order.totalCents)}</td>
                  <td className="px-4 py-3 text-muted">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
            {dtos.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">
                  {t.noOrders}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
