"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Dictionary } from "@/lib/i18n/translations";

export function TrackOrderClient({ dict }: { dict: Dictionary }) {
  const t = dict.track;
  const router = useRouter();
  const [orderId, setOrderId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = orderId.trim();
    if (!id) return;

    setIsChecking(true);
    setError(null);
    const res = await fetch(`/api/orders/${id}`);
    setIsChecking(false);

    if (!res.ok) {
      setError(t.notFound);
      return;
    }
    router.push(`/order/${id}/status`);
  };

  return (
    <div className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-bold text-text">{t.title}</h1>
      <p className="mt-2 text-muted">{t.subtitle}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label className="block text-sm font-medium text-text">{t.inputLabel}</label>
          <input
            required
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={isChecking} className="btn btn-primary w-full">
          {t.button}
        </button>
      </form>
    </div>
  );
}
