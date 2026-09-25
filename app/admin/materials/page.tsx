import { MaterialImagesAdmin } from "@/components/MaterialImagesAdmin";
import { prisma } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";
import { materialImageUrl } from "@/lib/types";

export default async function AdminMaterialsPage() {
  const dict = getDictionary(await getServerLocale());
  const t = dict.admin;

  const materials = await prisma.material.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      imageKey: true,
      colors: { select: { id: true, name: true, nameRu: true, hex: true }, orderBy: { name: "asc" } },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-text">{t.materialImagesTitle}</h1>
      <p className="mt-1 text-sm text-muted">{t.materialImagesHint}</p>
      <div className="mt-6">
        <MaterialImagesAdmin
          dict={dict}
          materials={materials.map((m) => ({
            id: m.id,
            name: m.name,
            imageUrl: materialImageUrl(m.id, m.imageKey),
            colors: m.colors,
          }))}
        />
      </div>
    </div>
  );
}
