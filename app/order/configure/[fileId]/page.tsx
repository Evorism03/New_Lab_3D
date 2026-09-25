import { notFound } from "next/navigation";

import { ConfigureClient } from "@/components/ConfigureClient";
import { prisma } from "@/lib/db";
import { localizeCatalogText } from "@/lib/i18n/catalog";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";
import { serializeFile } from "@/lib/serializers";
import { materialImageUrl } from "@/lib/types";

export default async function ConfigurePage({
  params,
}: {
  params: Promise<{ fileId: string }>;
}) {
  const { fileId } = await params;
  const dict = getDictionary(await getServerLocale());

  const [file, materials] = await Promise.all([
    prisma.uploadedFile.findUnique({ where: { id: fileId } }),
    prisma.material.findMany({
      where: { active: true },
      include: { colors: true, finishes: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!file) notFound();

  if (file.status === "ANALYZING") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <p className="text-muted">{dict.configure.analyzing}</p>
      </div>
    );
  }

  if (file.status === "ERROR") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <p className="font-medium text-danger">{dict.configure.errorTitle}</p>
        <p className="mt-2 text-muted">{file.errorMessage}</p>
      </div>
    );
  }

  return (
    <ConfigureClient
      dict={dict}
      file={serializeFile(file)}
      materials={materials.map((m) => ({
        id: m.id,
        name: m.name,
        description: localizeCatalogText(m.description, dict.locale),
        pricePerCm3: Number(m.pricePerCm3),
        setupFeeCents: m.setupFeeCents,
        minPriceCents: m.minPriceCents,
        leadTimeDays: m.leadTimeDays,
        strength: m.strength,
        flexibility: m.flexibility,
        heatResistance: m.heatResistance,
        bestFor: localizeCatalogText(m.bestFor, dict.locale),
        imageUrl: materialImageUrl(m.id, m.imageKey),
        colors: m.colors.map((c) => ({ id: c.id, name: localizeCatalogText(c.name, dict.locale, c.nameRu), hex: c.hex })),
        finishes: m.finishes.map((f) => ({
          id: f.id,
          name: localizeCatalogText(f.name, dict.locale, f.nameRu),
          multiplier: Number(f.multiplier),
        })),
      }))}
    />
  );
}
