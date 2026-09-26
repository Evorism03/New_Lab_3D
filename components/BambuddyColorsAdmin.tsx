"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatTemplate, type Dictionary } from "@/lib/i18n/translations";

type SyncResult = { spools: number; colors: number; skippedMaterials: string[] };

// Colors on the site come from the Bambuddy spool inventory (lib/colorSync.ts); this card
// holds the "min stock" threshold and a manual "sync now" on top of the automatic sync.
export function BambuddyColorsAdmin({
  dict,
  configured,
  minStockGrams,
  lastSyncAt,
  lastSyncError,
}: {
  dict: Dictionary;
  configured: boolean;
  minStockGrams: number;
  lastSyncAt: string;
  lastSyncError: string;
}) {
  const t = dict.admin;
  const router = useRouter();
  const [minStock, setMinStock] = useState(String(minStockGrams));
  const [busy, setBusy] = useState<"save" | "sync" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const saveMinStock = async () => {
    const value = Math.round(Number(minStock));
    if (minStock.trim() === "" || !(value >= 0)) {
      setMessage({ text: t.pricingInvalid, error: true });
      return;
    }
    setBusy("save");
    setMessage(null);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minStockGrams: value }),
    });
    setBusy(null);
    setMessage(res.ok ? { text: t.pricingSaved, error: false } : { text: t.pricingInvalid, error: true });
    if (res.ok) router.refresh();
  };

  const syncNow = async () => {
    setBusy("sync");
    setMessage(null);
    const res = await fetch("/api/admin/colors/sync", { method: "POST" });
    const body = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      setMessage({ text: `${t.syncFailed}: ${body?.error ?? res.statusText}`, error: true });
      return;
    }
    const result = body.result as SyncResult;
    let text = formatTemplate(formatTemplate(t.syncDone, result.spools), result.colors);
    if (result.skippedMaterials.length > 0) text += ` ${t.syncSkipped}: ${result.skippedMaterials.join(", ")}`;
    setMessage({ text, error: false });
    router.refresh();
  };

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-text">{t.stockTitle}</h2>
          <p className="mt-1 text-xs text-muted">{configured ? t.stockHint : t.stockNotConfigured}</p>
        </div>
        {configured && (
          <button
            type="button"
            onClick={syncNow}
            disabled={busy !== null}
            className="btn btn-outline shrink-0 px-3 py-1.5 text-sm"
          >
            {busy === "sync" ? t.saving : t.syncNow}
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          {t.minStockLabel}
          <input
            type="number"
            min={0}
            value={minStock}
            onChange={(e) => setMinStock(e.target.value)}
            className="w-24 px-3 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={saveMinStock}
          disabled={busy !== null || minStock === String(minStockGrams)}
          className="btn btn-primary px-4 py-1.5 text-sm"
        >
          {busy === "save" ? t.saving : t.savePricing}
        </button>
      </div>

      {configured && (
        <p className="mt-3 text-xs text-muted">
          {t.lastSync}: {lastSyncAt ? new Date(lastSyncAt).toLocaleString(dict.locale) : t.lastSyncNever}
          {lastSyncError && <span className="text-danger"> · {lastSyncError}</span>}
        </p>
      )}
      {message && <p className={`mt-2 text-sm ${message.error ? "text-danger" : "text-accent"}`}>{message.text}</p>}
    </div>
  );
}
