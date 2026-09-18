"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import type { Dictionary } from "@/lib/i18n/translations";
import { formatCents, type QuoteDTO } from "@/lib/types";

function CheckoutForm({ dict }: { dict: Dictionary }) {
  const t = dict.checkout;
  const searchParams = useSearchParams();
  const fileId = searchParams.get("fileId") ?? "";
  const materialId = searchParams.get("materialId") ?? "";
  const colorId = searchParams.get("colorId") ?? undefined;
  const finishId = searchParams.get("finishId") ?? undefined;
  const quantity = Number(searchParams.get("quantity") ?? 1);
  const cancelled = searchParams.get("checkout") === "cancelled";

  const [quote, setQuote] = useState<QuoteDTO | null>(null);
  const [form, setForm] = useState({
    email: "",
    name: "",
    address: "",
    city: "",
    postal: "",
    country: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId || !materialId) return;
    fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, materialId, colorId, finishId, quantity }),
    })
      .then((res) => res.json())
      .then((data) => setQuote(data.quote))
      .catch(() => setError("Failed to load quote"));
  }, [fileId, materialId, colorId, finishId, quantity]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ fileId, materialId, colorId, finishId, quantity }],
          email: form.email,
          shipping: {
            name: form.name,
            address: form.address,
            city: form.city,
            postal: form.postal,
            country: form.country,
          },
        }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderData.error?.formErrors?.[0] ?? orderData.error ?? "Failed to create order");

      const checkoutRes = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: orderData.order.id }),
      });
      const checkoutData = await checkoutRes.json();
      if (!checkoutRes.ok) throw new Error(checkoutData.error ?? "Failed to start payment");

      window.location.href = checkoutData.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-bold text-text">{t.title}</h1>

      {cancelled && (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          {t.cancelledNotice}
        </p>
      )}

      <div className="card mt-6 flex items-baseline justify-between p-4">
        <span className="text-sm text-muted">{t.orderTotal}</span>
        <span className="text-xl font-bold text-text">
          {quote ? formatCents(quote.totalPriceCents) : "…"}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <Field label={t.email} type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        <Field label={t.fullName} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <Field label={t.address} value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
        <div className="grid grid-cols-2 gap-4">
          <Field label={t.city} value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
          <Field label={t.postal} value={form.postal} onChange={(v) => setForm({ ...form, postal: v })} />
        </div>
        <Field label={t.country} value={form.country} onChange={(v) => setForm({ ...form, country: v })} />

        {error && <p className="text-sm text-danger">{error}</p>}

        <button type="submit" disabled={isSubmitting || !quote} className="btn btn-primary w-full">
          {isSubmitting ? t.redirecting : t.payNow}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text">{label}</label>
      <input
        required
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 text-sm"
      />
    </div>
  );
}

export function CheckoutClient({ dict }: { dict: Dictionary }) {
  return (
    <Suspense fallback={null}>
      <CheckoutForm dict={dict} />
    </Suspense>
  );
}
