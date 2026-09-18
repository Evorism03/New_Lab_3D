"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Dictionary } from "@/lib/i18n/translations";

export type PricingMaterial = {
  id: string;
  name: string;
  pricePerCm3: number;
  setupFeeCents: number;
  minPriceCents: number;
  leadTimeDays: number;
  active: boolean;
  finishes: { id: string; name: string; multiplier: number }[];
};

const dollars = (cents: number) => (cents / 100).toString();

function MaterialPricingCard({ material, dict }: { material: PricingMaterial; dict: Dictionary }) {
  const t = dict.admin;
  const router = useRouter();
  const [pricePerCm3, setPricePerCm3] = useState(material.pricePerCm3.toString());
  const [setupFee, setSetupFee] = useState(dollars(material.setupFeeCents));
  const [minPrice, setMinPrice] = useState(dollars(material.minPriceCents));
  const [leadTime, setLeadTime] = useState(material.leadTimeDays.toString());
  const [active, setActive] = useState(material.active);
  const [multipliers, setMultipliers] = useState<Record<string, string>>(
    Object.fromEntries(material.finishes.map((f) => [f.id, f.multiplier.toString()])),
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const edited = () => {
    setStatus("idle");
    setMessage(null);
  };

  const save = async () => {
    const values = {
      pricePerCm3: Number(pricePerCm3),
      setupFeeCents: Math.round(Number(setupFee) * 100),
      minPriceCents: Math.round(Number(minPrice) * 100),
      leadTimeDays: Number(leadTime),
      active,
      finishes: material.finishes.map((f) => ({ id: f.id, multiplier: Number(multipliers[f.id]) })),
    };
    const numbers = [
      values.pricePerCm3,
      values.setupFeeCents,
      values.minPriceCents,
      values.leadTimeDays,
      ...values.finishes.map((f) => f.multiplier),
    ];
    if (numbers.some((n) => !Number.isFinite(n) || n < 0)) {
      setStatus("error");
      setMessage(t.pricingInvalid);
      return;
    }

    setStatus("saving");
    setMessage(null);
    const res = await fetch(`/api/materials/${material.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStatus("error");
      setMessage(data.error ?? t.pricingInvalid);
      return;
    }
    setStatus("saved");
    router.refresh();
  };

  const field = (label: string, value: string, onChange: (v: string) => void, step: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          edited();
        }}
        className="px-3 py-1.5 text-sm"
      />
    </label>
  );

  return (
    <div className={`card p-5 ${active ? "" : "opacity-70"}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-accent">{material.name}</h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => {
              setActive(e.target.checked);
              edited();
            }}
          />
          {t.activeLabel}
        </label>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {field(t.pricePerCm3Label, pricePerCm3, setPricePerCm3, "0.01")}
        {field(t.setupFeeLabel, setupFee, setSetupFee, "0.01")}
        {field(t.minPriceLabel, minPrice, setMinPrice, "0.01")}
        {field(t.leadTimeLabel, leadTime, setLeadTime, "1")}
      </div>

      {material.finishes.length > 0 && (
        <div className="mt-4">
          <span className="text-xs text-muted">{t.finishMultipliersLabel}</span>
          <div className="mt-1 flex flex-wrap gap-3">
            {material.finishes.map((f) => (
              <label key={f.id} className="flex items-center gap-2 text-sm text-text">
                {f.name}
                <input
                  type="number"
                  min={0}
                  step="0.05"
                  value={multipliers[f.id]}
                  onChange={(e) => {
                    setMultipliers((prev) => ({ ...prev, [f.id]: e.target.value }));
                    edited();
                  }}
                  className="w-24 px-3 py-1.5 text-sm"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving"}
          className="btn btn-primary px-4 py-1.5 text-sm"
        >
          {status === "saving" ? t.saving : t.savePricing}
        </button>
        {status === "saved" && <span className="text-sm text-accent">{t.pricingSaved}</span>}
        {status === "error" && message && <span className="text-sm text-danger">{message}</span>}
      </div>
    </div>
  );
}

export function PricingAdmin({
  materials,
  dict,
}: {
  materials: PricingMaterial[];
  dict: Dictionary;
}) {
  return (
    <div className="flex flex-col gap-5">
      {materials.map((m) => (
        <MaterialPricingCard key={m.id} material={m} dict={dict} />
      ))}
    </div>
  );
}
