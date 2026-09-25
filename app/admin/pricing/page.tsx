import { PricingAdmin } from "@/components/PricingAdmin";
import { prisma } from "@/lib/db";
import { localizeCatalogText } from "@/lib/i18n/catalog";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";

export default async function AdminPricingPage() {
  const dict = getDictionary(await getServerLocale());
  const t = dict.admin;

  const materials = await prisma.material.findMany({
    orderBy: { name: "asc" },
    include: { finishes: { orderBy: { name: "asc" } } },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-text">{t.pricingTitle}</h1>
      <p className="mt-1 text-sm text-muted">{t.pricingHint}</p>
      <div className="mt-6">
        <PricingAdmin
          dict={dict}
          materials={materials.map((m) => ({
            id: m.id,
            name: m.name,
            pricePerCm3: Number(m.pricePerCm3),
            setupFeeCents: m.setupFeeCents,
            minPriceCents: m.minPriceCents,
            leadTimeDays: m.leadTimeDays,
            active: m.active,
            finishes: m.finishes.map((f) => ({
              id: f.id,
              name: localizeCatalogText(f.name, dict.locale, f.nameRu),
              multiplier: Number(f.multiplier),
            })),
          }))}
        />
      </div>
    </div>
  );
}
