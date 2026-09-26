import { BambuddyColorsAdmin } from "@/components/BambuddyColorsAdmin";
import { InfillLevelsAdmin } from "@/components/InfillLevelsAdmin";
import { PricingAdmin } from "@/components/PricingAdmin";
import { isBambuddyConfigured } from "@/lib/bambuddy";
import { ensureColorsFresh, getColorAvailability, isColorAvailable } from "@/lib/colorSync";
import { prisma } from "@/lib/db";
import { getInfillOptions, getSettings } from "@/lib/settings";
import { localizeCatalogText } from "@/lib/i18n/catalog";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";
import { resolvePricing } from "@/lib/pricing/defaults";

export default async function AdminPricingPage() {
  const dict = getDictionary(await getServerLocale());
  const t = dict.admin;

  // Also kicks off the periodic Bambuddy sync, so the stock numbers below are fresh.
  await ensureColorsFresh();
  const [materials, availability, settings, infill] = await Promise.all([
    prisma.material.findMany({
      orderBy: { name: "asc" },
      include: {
        finishes: { orderBy: { name: "asc" } },
        colors: { orderBy: [{ variant: "asc" }, { name: "asc" }] },
      },
    }),
    getColorAvailability(),
    getSettings(["bambuddy.lastSyncAt", "bambuddy.lastSyncError"]),
    getInfillOptions(),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-text">{t.pricingTitle}</h1>
      <p className="mt-1 text-sm text-muted">{t.pricingHint}</p>
      <div className="mt-6">
        <BambuddyColorsAdmin
          dict={dict}
          configured={isBambuddyConfigured()}
          minStockGrams={availability.minStockGrams}
          lastSyncAt={settings["bambuddy.lastSyncAt"]}
          lastSyncError={settings["bambuddy.lastSyncError"]}
        />
      </div>
      <div className="mt-5">
        <InfillLevelsAdmin dict={dict} levels={infill.levels} defaultLevel={infill.defaultLevel} />
      </div>
      <div className="mt-5">
        <PricingAdmin
          dict={dict}
          materials={materials.map((m) => ({
            id: m.id,
            name: m.name,
            ...resolvePricing(m),
            setupFeeCents: m.setupFeeCents,
            minPriceCents: m.minPriceCents,
            leadTimeDays: m.leadTimeDays,
            active: m.active,
            colors: m.colors.map((c) => ({
              id: c.id,
              name: c.name,
              nameRu: c.nameRu,
              hex: c.hex,
              variant: c.variant,
              source: c.source,
              stockGrams: c.stockGrams,
              spoolPriceCents: c.spoolPriceCents,
              available: isColorAvailable(c, availability),
            })),
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
