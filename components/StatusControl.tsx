"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Dictionary } from "@/lib/i18n/translations";

const STATUSES = [
  "AWAITING_PAYMENT",
  "PAID",
  "QUEUED",
  "PRINTING",
  "READY",
  "SHIPPED",
  "CANCELLED",
] as const;

export function StatusControl({
  orderId,
  currentStatus,
  dict,
}: {
  orderId: string;
  currentStatus: string;
  dict: Dictionary;
}) {
  const t = dict.admin;
  const statusLabels = dict.orderStatus.status;
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setIsSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to update status");
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-1.5 text-sm">
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {statusLabels[s as keyof typeof statusLabels] ?? s}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving || status === currentStatus}
        className="btn btn-primary px-3 py-1.5 text-sm"
      >
        {isSaving ? t.saving : t.updateStatus}
      </button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
