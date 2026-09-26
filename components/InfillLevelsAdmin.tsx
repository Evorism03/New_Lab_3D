"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Dictionary } from "@/lib/i18n/translations";

// Infill levels customers pick from on the order page (lib/settings.ts getInfillOptions).
export function InfillLevelsAdmin({
  dict,
  levels,
  defaultLevel,
}: {
  dict: Dictionary;
  levels: number[];
  defaultLevel: number;
}) {
  const t = dict.admin;
  const router = useRouter();
  const [levelsText, setLevelsText] = useState(levels.join(", "));
  const [defaultText, setDefaultText] = useState(String(defaultLevel));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const parsed = levelsText
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  const valid =
    parsed.length > 0 &&
    parsed.length <= 10 &&
    parsed.every((n) => Number.isInteger(n) && n >= 1 && n <= 100) &&
    parsed.includes(Number(defaultText));

  const save = async () => {
    if (!valid) {
      setMessage({ text: t.infillInvalid, error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ infillLevels: parsed, defaultInfill: Number(defaultText) }),
    });
    setBusy(false);
    setMessage(res.ok ? { text: t.pricingSaved, error: false } : { text: t.infillInvalid, error: true });
    if (res.ok) router.refresh();
  };

  return (
    <div className="card p-5">
      <h2 className="font-semibold text-text">{t.infillTitle}</h2>
      <p className="mt-1 text-xs text-muted">{t.infillAdminHint}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          {t.infillLevelsLabel}
          <input
            value={levelsText}
            onChange={(e) => setLevelsText(e.target.value)}
            placeholder="15, 25, 50, 100"
            className="w-44 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          {t.infillDefaultLabel}
          <input
            type="number"
            min={1}
            max={100}
            value={defaultText}
            onChange={(e) => setDefaultText(e.target.value)}
            className="w-20 px-3 py-1.5 text-sm"
          />
        </label>
        <button type="button" onClick={save} disabled={busy} className="btn btn-primary px-4 py-1.5 text-sm">
          {busy ? t.saving : t.savePricing}
        </button>
      </div>
      {message && <p className={`mt-2 text-sm ${message.error ? "text-danger" : "text-accent"}`}>{message.text}</p>}
    </div>
  );
}
