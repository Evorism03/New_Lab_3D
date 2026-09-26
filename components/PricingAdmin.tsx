"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { type AdminColor, ColorSuggestions, MaterialColorsAdmin } from "@/components/MaterialColorsAdmin";
import { formatPrintTime, formatTemplate, type Dictionary } from "@/lib/i18n/translations";
import { formatCents } from "@/lib/money";
import { computePrice } from "@/lib/pricing/engine";

export type PricingMaterial = {
  id: string;
  name: string;
  hourlyRateCents: number;
  printSpeedCm3PerHour: number;
  spoolPriceCents: number;
  spoolWeightG: number;
  densityGcm3: number;
  infillPercent: number;
  setupFeeCents: number;
  minPriceCents: number;
  leadTimeDays: number;
  active: boolean;
  finishes: { id: string; name: string; multiplier: number }[];
  colors: AdminColor[];
};

const rubles = (cents: number) => (cents / 100).toString();
const EXAMPLE_VOLUME_CM3 = 50;

function MaterialPricingCard({ material, dict }: { material: PricingMaterial; dict: Dictionary }) {
  const t = dict.admin;
  const router = useRouter();
  const [hourlyRate, setHourlyRate] = useState(rubles(material.hourlyRateCents));
  const [printSpeed, setPrintSpeed] = useState(material.printSpeedCm3PerHour.toString());
  const [spoolPrice, setSpoolPrice] = useState(rubles(material.spoolPriceCents));
  const [spoolWeight, setSpoolWeight] = useState(material.spoolWeightG.toString());
  const [density, setDensity] = useState(material.densityGcm3.toString());
  const [infill, setInfill] = useState(material.infillPercent.toString());
  const [setupFee, setSetupFee] = useState(rubles(material.setupFeeCents));
  const [minPrice, setMinPrice] = useState(rubles(material.minPriceCents));
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

  const values = () => ({
    hourlyRateCents: Math.round(Number(hourlyRate) * 100),
    printSpeedCm3PerHour: Number(printSpeed),
    spoolPriceCents: Math.round(Number(spoolPrice) * 100),
    spoolWeightG: Math.round(Number(spoolWeight)),
    densityGcm3: Number(density),
    infillPercent: Math.round(Number(infill)),
    setupFeeCents: Math.round(Number(setupFee) * 100),
    minPriceCents: Math.round(Number(minPrice) * 100),
    leadTimeDays: Number(leadTime),
    active,
    finishes: material.finishes.map((f) => ({ id: f.id, multiplier: Number(multipliers[f.id]) })),
  });

  const validate = (v: ReturnType<typeof values>) => {
    const numbers = [
      v.hourlyRateCents,
      v.spoolPriceCents,
      v.setupFeeCents,
      v.minPriceCents,
      v.leadTimeDays,
      ...v.finishes.map((f) => f.multiplier),
    ];
    if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return false;
    if (!(v.printSpeedCm3PerHour > 0) || !(v.spoolWeightG > 0) || !(v.densityGcm3 > 0)) return false;
    return v.infillPercent >= 1 && v.infillPercent <= 100;
  };

  const save = async () => {
    const v = values();
    if (!validate(v)) {
      setStatus("error");
      setMessage(t.pricingInvalid);
      return;
    }

    setStatus("saving");
    setMessage(null);
    const res = await fetch(`/api/materials/${material.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(v),
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

  // Live example so the admin sees what the numbers mean for a typical part.
  const v = values();
  const example = validate(v)
    ? computePrice({
        volumeCm3: EXAMPLE_VOLUME_CM3,
        hourlyRateCents: v.hourlyRateCents,
        printSpeedCm3PerHour: v.printSpeedCm3PerHour,
        spoolPriceCents: v.spoolPriceCents,
        spoolWeightG: v.spoolWeightG,
        densityGcm3: v.densityGcm3,
        infillPercent: v.infillPercent,
        setupFeeCents: v.setupFeeCents,
        minPriceCents: v.minPriceCents,
        quantity: 1,
      })
    : null;

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

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {field(t.hourlyRateLabel, hourlyRate, setHourlyRate, "1")}
        {field(t.printSpeedLabel, printSpeed, setPrintSpeed, "0.5")}
        {field(t.infillLabel, infill, setInfill, "1")}
        {field(t.spoolPriceLabel, spoolPrice, setSpoolPrice, "10")}
        {field(t.spoolWeightLabel, spoolWeight, setSpoolWeight, "50")}
        {field(t.densityLabel, density, setDensity, "0.01")}
        {field(t.setupFeeLabel, setupFee, setSetupFee, "1")}
        {field(t.minPriceLabel, minPrice, setMinPrice, "1")}
        {field(t.leadTimeLabel, leadTime, setLeadTime, "1")}
      </div>

      {example && (
        <p className="mt-3 text-xs text-muted">
          {formatTemplate(t.exampleLabel, EXAMPLE_VOLUME_CM3)}:{" "}
          <span className="text-text">
            {formatPrintTime(example.printHoursTotal, dict.units)}, {Math.round(example.plasticGramsTotal)}{" "}
            {dict.units.g} — {formatCents(example.unitPriceCents, dict.locale)}
          </span>
        </p>
      )}

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

      <div className="-mx-5 -mb-5 mt-5 bg-white/[0.02]">
        <MaterialColorsAdmin materialId={material.id} colors={material.colors} dict={dict} />
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
      <ColorSuggestions />
      {materials.map((m) => (
        <MaterialPricingCard key={m.id} material={m} dict={dict} />
      ))}
    </div>
  );
}
