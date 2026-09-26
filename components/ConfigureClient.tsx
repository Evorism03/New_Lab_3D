"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { MaterialThumb } from "@/components/MaterialThumb";
import { ModelViewer } from "@/components/ModelViewer";
import { formatDays, formatPrintTime, formatTemplate, type Dictionary } from "@/lib/i18n/translations";
import { formatAmount, formatCents } from "@/lib/money";
import { MAX_SCALE_PERCENT, MIN_SCALE_PERCENT, scaledVolume } from "@/lib/pricing/options";
import type { FileDTO, MaterialDTO, QuoteDTO } from "@/lib/types";

/** Falls back to the first option whenever `selectedId` doesn't belong to the current list
 *  (e.g. right after switching material) — avoids a setState-in-effect render cascade. */
function resolveSelection(selectedId: string, options: { id: string }[]): string {
  return options.some((o) => o.id === selectedId) ? selectedId : (options[0]?.id ?? "");
}

const SLIDER_MAX_SCALE = 300;

export function ConfigureClient({
  file,
  materials,
  infillLevels,
  defaultInfill,
  dict,
}: {
  file: FileDTO;
  materials: MaterialDTO[];
  /** Slicer infill levels (%) the customer picks from — admin setting. */
  infillLevels: number[];
  defaultInfill: number;
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
  const [infill, setInfill] = useState(defaultInfill);
  // Typed text is kept as is while editing; the price and sizes use the clamped value.
  const [scaleText, setScaleText] = useState("100");
  const scale = Math.min(MAX_SCALE_PERCENT, Math.max(MIN_SCALE_PERCENT, Math.round(Number(scaleText)) || 100));
  const [quote, setQuote] = useState<QuoteDTO | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);

  const colorId = resolveSelection(selectedColorId, material?.colors ?? []);
  const colorGroups = useMemo(() => {
    const groups: { variant: string; colors: MaterialDTO["colors"] }[] = [];
    for (const c of material?.colors ?? []) {
      const group = groups.find((g) => g.variant === c.variant);
      if (group) group.colors.push(c);
      else groups.push({ variant: c.variant, colors: [c] });
    }
    return groups;
  }, [material]);
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
          scalePercent: scale,
          infillPercent: infill,
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
  }, [file.id, material, colorId, finishId, quantity, scale, infill]);

  if (!material) {
    return <p className="mx-auto max-w-2xl px-6 py-24 text-muted">{t.noMaterials}</p>;
  }

  const handleContinue = () => {
    const params = new URLSearchParams({
      fileId: file.id,
      materialId: material.id,
      quantity: String(quantity),
      scale: String(scale),
      infill: String(infill),
    });
    if (colorId) params.set("colorId", colorId);
    if (finishId) params.set("finishId", finishId);
    router.push(`/order/checkout?${params.toString()}`);
  };

  const size = (mm: number | undefined) => (mm === undefined ? "—" : ((mm * scale) / 100).toFixed(1));
  const sizeText = `${size(file.bboxMm?.x)} × ${size(file.bboxMm?.y)} × ${size(file.bboxMm?.z)} ${dict.units.mm}`;

  return (
    // The settings panel keeps a fixed width; the model viewer takes all the rest of the screen.
    <div className="grid grid-cols-1 gap-8 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(600px,700px)]">
      <div>
        <div className="h-[55vh] min-h-[360px] lg:h-[calc(100vh-240px)] lg:min-h-[480px]">
          <ModelViewer fileUrl={`/api/files/${file.id}/raw`} format={file.format} />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-4 text-sm text-muted">
          <div>
            <dt className="font-medium text-text">{t.volume}</dt>
            <dd>
              {file.volumeCm3 !== null && scaledVolume(file.volumeCm3, scale).toFixed(2)} {dict.units.cm3}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-text">{t.boundingBox}</dt>
            <dd>{sizeText}</dd>
          </div>
          <div>
            <dt className="font-medium text-text">{t.file}</dt>
            <dd className="truncate">{file.originalName}</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-col lg:sticky lg:top-[80px] lg:h-[calc(100vh-104px)]">
        <h1 className="text-xl font-bold text-text">{t.title}</h1>

        {/* Plastics in their own column, and right next to it everything about the chosen one
            (color, finish, quantity, price) — no scrolling down past all the materials. */}
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:min-h-0 lg:flex-1">
        <div className="lg:min-h-0 lg:overflow-y-auto lg:pr-2">
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

        <div className="flex flex-col lg:min-h-0">
        {/* Not flex-1: the price card sits right under the options instead of at the bottom. */}
        <div className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
        {material.colors.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-text">{t.color}</label>
            {colorGroups.map((group) => (
              <div key={group.variant}>
                {/* Composites (e.g. ABS-CF15) are listed under their base material as their own group. */}
                {colorGroups.length > 1 && (
                  <div className="mt-2 text-xs text-muted">{group.variant || material.name}</div>
                )}
                <div className="mt-1 flex flex-wrap gap-2">
                  {group.colors.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setColorId(c.id)}
                      className={`pill inline-flex items-center gap-2 ${colorId === c.id ? "active" : ""}`}
                    >
                      <span
                        aria-hidden
                        className="h-3 w-3 shrink-0 rounded-full border border-border"
                        style={{ background: c.hex }}
                      />
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {material.finishes.length > 0 && (
          <div>
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

        {infillLevels.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-text">{t.infill}</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {infillLevels.map((level) => {
                const name = t.infillNames[level as keyof typeof t.infillNames];
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setInfill(level)}
                    className={`pill ${infill === level ? "active" : ""}`}
                  >
                    {name ? `${name} ${level}%` : `${level}%`}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-muted">{t.infillHint}</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text">{t.scale}</label>
          <div className="mt-1 flex items-center gap-3">
            <input
              type="range"
              min={MIN_SCALE_PERCENT}
              max={SLIDER_MAX_SCALE}
              step={5}
              value={Math.min(scale, SLIDER_MAX_SCALE)}
              onChange={(e) => setScaleText(e.target.value)}
              aria-label={t.scale}
              className="min-w-0 flex-1 accent-accent"
            />
            <input
              type="number"
              min={MIN_SCALE_PERCENT}
              max={MAX_SCALE_PERCENT}
              value={scaleText}
              onChange={(e) => setScaleText(e.target.value)}
              onBlur={() => setScaleText(String(scale))}
              className="w-20 px-3 py-1.5 text-sm"
            />
            <span className="text-sm text-muted">%</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {formatTemplate(t.scaleSize, sizeText)}
            {scale !== 100 && (
              <>
                {" · "}
                <button type="button" onClick={() => setScaleText("100")} className="text-accent hover:underline">
                  {t.scaleReset}
                </button>
              </>
            )}
          </p>
        </div>

        <div>
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
      </div>
    </div>
  );
}
