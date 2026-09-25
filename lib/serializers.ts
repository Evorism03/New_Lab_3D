import type { Color, Finish, Material, Order, OrderItem, UploadedFile } from "@/lib/generated/prisma/client";

export function serializeFile(f: UploadedFile) {
  return {
    id: f.id,
    originalName: f.originalName,
    format: f.format,
    sizeBytes: f.sizeBytes,
    status: f.status,
    errorMessage: f.errorMessage,
    volumeCm3: f.volumeCm3 !== null ? Number(f.volumeCm3) : null,
    bboxMm:
      f.bboxXMm !== null && f.bboxYMm !== null && f.bboxZMm !== null
        ? { x: Number(f.bboxXMm), y: Number(f.bboxYMm), z: Number(f.bboxZMm) }
        : null,
    triangleCount: f.triangleCount,
    createdAt: f.createdAt.toISOString(),
  };
}

type OrderItemWithRelations = OrderItem & {
  file: UploadedFile;
  material: Material;
  color: Color | null;
  finish: Finish | null;
};

export function serializeOrderItem(item: OrderItemWithRelations) {
  return {
    id: item.id,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    totalPriceCents: item.totalPriceCents,
    file: {
      id: item.file.id,
      originalName: item.file.originalName,
      format: item.file.format,
      volumeCm3: item.file.volumeCm3 !== null ? Number(item.file.volumeCm3) : null,
    },
    material: { id: item.material.id, name: item.material.name },
    color: item.color ? { id: item.color.id, name: item.color.name, nameRu: item.color.nameRu } : null,
    finish: item.finish ? { id: item.finish.id, name: item.finish.name, nameRu: item.finish.nameRu } : null,
  };
}

export function serializeOrder(order: Order & { items: OrderItemWithRelations[] }) {
  return {
    id: order.id,
    status: order.status,
    email: order.email,
    shipping: {
      name: order.shippingName,
      address: order.shippingAddress,
      city: order.shippingCity,
      postal: order.shippingPostal,
      country: order.shippingCountry,
    },
    totalCents: order.totalCents,
    items: order.items.map(serializeOrderItem),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
