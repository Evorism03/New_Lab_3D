"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { POPULAR_COLORS_RU, translateColorRuToEn } from "@/lib/i18n/colorNames";
import { localizeCatalogText } from "@/lib/i18n/catalog";
import { formatTemplate, type Dictionary } from "@/lib/i18n/translations";

export type AdminColor = {
  id: string;
  name: string;
  nameRu: string | null;
  hex: string;
  variant: string;
  source: string;
  stockGrams: number | null;
  spoolPriceCents: number | null;
  /** Whether customers can pick it right now (lib/colorSync.ts isColorAvailable). */
  available: boolean;
};

const DATALIST_ID = "popular-plastic-colors";

const rubles = (cents: number | null) => (cents === null ? "" : (cents / 100).toString());

function ColorRow({
  materialId,
  materialSpoolPriceCents,
  color,
  dict,
  onError,
}: {
  materialId: string;
  materialSpoolPriceCents: number;
  color: AdminColor;
  dict: Dictionary;
  onError: (message: string | null) => void;
}) {
  const t = dict.admin;
  const router = useRouter();
  // Existing seeded colors are stored in English; show them by their Russian name.
  const initialName = localizeCatalogText(color.name, "ru", color.nameRu);
  const [hex, setHex] = useState(color.hex);
  const [name, setName] = useState(initialName);
  const [spoolPrice, setSpoolPrice] = useState(rubles(color.spoolPriceCents));
  const [busy, setBusy] = useState(false);

  const spoolPriceCents = spoolPrice.trim() === "" ? null : Math.round(Number(spoolPrice) * 100);
  const dirty =
    hex !== color.hex || name.trim() !== initialName || spoolPriceCents !== color.spoolPriceCents;
  const fromBambuddy = color.source === "bambuddy";

  const save = async () => {
    if (!dirty || busy || !name.trim()) return;
    if (spoolPriceCents !== null && !(spoolPriceCents >= 0)) {
      onError(t.pricingInvalid);
      return;
    }
    setBusy(true);
    onError(null);
    const res = await fetch(`/api/materials/${materialId}/colors/${color.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nameRu: name, hex, spoolPriceCents }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      onError(data?.error ?? t.colorSaveError);
      return;
    }
    router.refresh();
  };

  const remove = async () => {
    setBusy(true);
    onError(null);
    const res = await fetch(`/api/materials/${materialId}/colors/${color.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      onError(t.colorSaveError);
      return;
    }
    router.refresh();
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${color.available ? "" : "opacity-50"}`}>
      <input
        type="color"
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        onBlur={save}
        aria-label={t.colorsTitle}
        className="h-9 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
      <input
        list={DATALIST_ID}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder={t.colorNameLabel}
        className="min-w-0 flex-1 px-3 py-1.5 text-sm"
      />
      {color.variant && <span className="shrink-0 text-xs text-accent">{color.variant}</span>}
      <span className="w-36 shrink-0 text-right text-xs text-muted">
        {fromBambuddy ? formatTemplate(t.colorStockGrams, color.stockGrams ?? 0) : t.colorManual}
        {!color.available && ` · ${t.colorHidden}`}
      </span>
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted" title={t.colorSpoolPriceHint}>
        {t.colorSpoolPrice}
        <input
          type="number"
          min={0}
          value={spoolPrice}
          onChange={(e) => setSpoolPrice(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder={rubles(materialSpoolPriceCents)}
          className="w-24 px-2 py-1.5 text-sm"
        />
      </label>
      {/* A synced color comes back on the next sync, so only manual colors can be deleted. */}
      {fromBambuddy ? (
        <span className="w-5 shrink-0" />
      ) : (
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          title={t.deleteColor}
          aria-label={t.deleteColor}
          className="w-5 shrink-0 px-1 text-lg leading-none text-muted transition-colors hover:text-danger"
        >
          ×
        </button>
      )}
    </div>
  );
}

// Rendered once per page: every color name field points at this list of popular plastic colors.
export function ColorSuggestions() {
  return (
    <datalist id={DATALIST_ID}>
      {POPULAR_COLORS_RU.map((c) => (
        <option key={c} value={c} />
      ))}
    </datalist>
  );
}

export function MaterialColorsAdmin({
  materialId,
  materialSpoolPriceCents,
  colors,
  dict,
}: {
  materialId: string;
  materialSpoolPriceCents: number;
  colors: AdminColor[];
  dict: Dictionary;
}) {
  const t = dict.admin;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hex, setHex] = useState("#888888");
  const [name, setName] = useState("");

  const en = name.trim() ? translateColorRuToEn(name) : null;

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/materials/${materialId}/colors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nameRu: name, hex }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? t.colorSaveError);
      return;
    }
    setName("");
    router.refresh();
  };

  return (
    <div className="border-t border-border p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t.colorsTitle}</span>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex flex-col gap-2">
        {colors.length === 0 && <p className="text-xs text-muted">{t.noColors}</p>}
        {colors.map((c) => (
          <ColorRow
            key={`${c.id}:${c.hex}:${c.name}:${c.nameRu ?? ""}:${c.spoolPriceCents ?? ""}`}
            materialId={materialId}
            materialSpoolPriceCents={materialSpoolPriceCents}
            color={c}
            dict={dict}
            onError={setError}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          aria-label={t.addColor}
          className="h-9 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
        />
        <input
          list={DATALIST_ID}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
          placeholder={t.colorNameLabel}
          className="min-w-0 flex-1 px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !name.trim()}
          className="btn btn-outline shrink-0 px-3 py-1.5 text-xs"
        >
          {t.addColor}
        </button>
      </div>
      {name.trim() && (
        <p className="mt-1.5 text-xs text-muted">
          {t.colorEnPreview}: {en ? <span className="text-text">{en}</span> : t.colorEnUnknown}
        </p>
      )}
    </div>
  );
}
