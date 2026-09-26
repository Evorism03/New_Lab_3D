"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { MaterialThumb } from "@/components/MaterialThumb";
import { ModelViewer } from "@/components/ModelViewer";
import { formatDays, formatPrintTime, formatTemplate, type Dictionary } from "@/lib/i18n/translations";
import { formatAmount, formatCents } from "@/lib/money";
import type { FileDTO, MaterialDTO, QuoteDTO } from "@/lib/types";

/** Falls back to the first option whenever `selectedId` doesn't belong to the current list
 *  (e.g. right after switching material) — avoids a setState-in-effect render cascade. */
function resolveSelection(selectedId: string, options: { id: string }[]): string {
  return options.some((o) => o.id === selectedId) ? selectedId : (options[0]?.id ?? "");
}

export function ConfigureClient({
  file,
  materials,
  dict,
}: {
  file: FileDTO;
  materials: MaterialDTO[];
  dict: Dictionary;
}) {
  const t = dict.configure;
  const router = useRouter();
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? "");
  const material = useMemo(
    () => materials.find((m) => m.id === materialId) ?? materials[0],
    [materials, materialId],
  );

  const [selectedColorId, setColorId] = useState(material?.colors[0]?.id ?? "");
  const [selectedFinishId, setFinishId] = useState(material?.finishes[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [quote, setQuote] = useState<QuoteDTO | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);

  const colorId = resolveSelection(selectedColorId, material?.colors ?? []);
  const finishId = resolveSelection(selectedFinishId, material?.finishes ?? []);

  useEffect(() => {
    if (!material) return;
    const timeout = setTimeout(() => {
      setIsQuoting(true);
      setQuoteError(null);
      fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: file.id,
          materialId: material.id,
          colorId: colorId || undefined,
          finishId: finishId || undefined,
          quantity,
        }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Failed to get quote");
          setQuote(data.quote);
        })
        .catch((err) => setQuoteError(err.message))
        .finally(() => setIsQuoting(false));
    }, 250);

    return () => clearTimeout(timeout);
  }, [file.id, material, colorId, finishId, quantity]);

  if (!material) {
    return <p className="mx-auto max-w-2xl px-6 py-24 text-muted">{t.noMaterials}</p>;
  }

  const handleContinue = () => {
    const params = new URLSearchParams({
      fileId: file.id,
      materialId: material.id,
      quantity: String(quantity),
    });
    if (colorId) params.set("colorId", colorId);
    if (finishId) params.set("finishId", finishId);
    router.push(`/order/checkout?${params.toString()}`);
  };

  return (
    <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-8 px-6 py-6 lg:grid-cols-[minmax(0,2fr)_minmax(380px,1fr)]">
      <div>
        <div className="h-[55vh] min-h-[360px] lg:h-[calc(100vh-240px)] lg:min-h-[480px]">
          <ModelViewer fileUrl={`/api/files/${file.id}/raw`} format={file.format} />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-4 text-sm text-muted">
          <div>
            <dt className="font-medium text-text">{t.volume}</dt>
            <dd>
              {file.volumeCm3?.toFixed(2)} {dict.units.cm3}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-text">{t.boundingBox}</dt>
            <dd>
              {file.bboxMm?.x.toFixed(1)} × {file.bboxMm?.y.toFixed(1)} × {file.bboxMm?.z.toFixed(1)} {dict.units.mm}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-text">{t.file}</dt>
            <dd className="truncate">{file.originalName}</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-col lg:sticky lg:top-[80px] lg:h-[calc(100vh-104px)]">
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
        <h1 className="text-xl font-bold text-text">{t.title}</h1>

        <div className="mt-6">
          <label className="block text-sm font-medium text-text">{t.material}</label>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {materials.map((m) => {
              const isSelected = m.id === material.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMaterialId(m.id)}
                  aria-pressed={isSelected}
                  className={`overflow-hidden rounded-xl border text-left transition-colors ${
                    isSelected
                      ? "border-accent bg-accent-soft"
                      : "border-border bg-bg-soft hover:border-accent/40"
                  }`}
                >
                  <MaterialThumb imageUrl={m.imageUrl} alt={m.name} className="aspect-[4/3] w-full" />
                  <div className="p-3">
                    <div className={`text-sm font-semibold ${isSelected ? "text-accent" : "text-text"}`}>
                      {m.name}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {formatAmount(m.hourlyRateCents / 100, dict.locale)} {t.perHour}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {material.description && (
            <p className="mt-3 text-xs text-muted">{material.description}</p>
          )}
        </div>

        {material.colors.length > 0 && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-text">{t.color}</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {material.colors.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColorId(c.id)}
                  className={`pill ${colorId === c.id ? "active" : ""}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {material.finishes.length > 0 && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-text">{t.finish}</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {material.finishes.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFinishId(f.id)}
                  className={`pill ${finishId === f.id ? "active" : ""}`}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <label className="block text-sm font-medium text-text">{t.quantity}</label>
          <input
            type="number"
            min={1}
            max={1000}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            className="mt-1 w-24 px-3 py-2 text-sm"
          />
        </div>
        </div>

        <div className="card mt-4 shrink-0 p-4">
          {quoteError && <p className="text-sm text-danger">{quoteError}</p>}
          {!quoteError && (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted">{t.estimatedTotal}</span>
                <span className="text-2xl font-bold text-text">
                  {quote ? formatCents(quote.totalPriceCents, dict.locale) : isQuoting ? "…" : "—"}
                </span>
              </div>
              {quote && (
                <>
                  <p className="mt-1 text-xs text-muted">
                    {formatCents(quote.unitPriceCents, dict.locale)} / {t.perUnit} ·{" "}
                    {formatTemplate(t.shipsIn, formatDays(quote.leadTimeDays, dict.locale))}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {t.estPrintTime} {formatPrintTime(quote.printHoursTotal, dict.units)} · {t.estPlastic}{" "}
                    {Math.max(1, Math.round(quote.plasticGramsTotal))} {dict.units.g}
                  </p>
                </>
              )}
            </>
          )}

          <button
            type="button"
            disabled={!quote}
            onClick={handleContinue}
            className="btn btn-primary mt-4 w-full"
          >
            {t.continueToCheckout}
          </button>
        </div>
      </div>
    </div>
  );
}
