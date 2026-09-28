"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AddressField } from "@/components/AddressField";
import { DELIVERY_SERVICES, type DeliveryService } from "@/lib/address";
import type { AddressSuggestion } from "@/lib/addressSuggest";
import type { Dictionary } from "@/lib/i18n/translations";
import { formatCents } from "@/lib/money";
import type { QuoteDTO } from "@/lib/types";

function CheckoutForm({ dict }: { dict: Dictionary }) {
  const t = dict.checkout;
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileId = searchParams.get("fileId") ?? "";
  const materialId = searchParams.get("materialId") ?? "";
  const colorId = searchParams.get("colorId") ?? undefined;
  const finishId = searchParams.get("finishId") ?? undefined;
  const quantity = Number(searchParams.get("quantity") ?? 1);
  const scalePercent = Number(searchParams.get("scale") ?? 100);
  // Missing (old links) = the default infill level, picked on the server.
  const infillPercent = searchParams.get("infill") ? Number(searchParams.get("infill")) : undefined;

  const [quote, setQuote] = useState<QuoteDTO | null>(null);
  const [form, setForm] = useState({
    email: "",
    name: "",
    phone: "",
    service: DELIVERY_SERVICES[0] as DeliveryService,
    extra: "",
  });
  // Each address field keeps what is shown plus the suggestion it came from (if any): the
  // suggestion's text with type goes to the CRM, and its id/bbox narrows the next field.
  const [city, setCity] = useState<{ text: string; picked: AddressSuggestion | null }>({ text: "", picked: null });
  const [street, setStreet] = useState<{ text: string; picked: AddressSuggestion | null }>({ text: "", picked: null });
  const [house, setHouse] = useState<{ text: string; picked: AddressSuggestion | null }>({ text: "", picked: null });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId || !materialId) return;
    fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, materialId, colorId, finishId, quantity, scalePercent, infillPercent }),
    })
      .then((res) => res.json())
      .then((data) => setQuote(data.quote))
      .catch(() => setError("Failed to load quote"));
  }, [fileId, materialId, colorId, finishId, quantity, scalePercent, infillPercent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ fileId, materialId, colorId, finishId, quantity, scalePercent, infillPercent }],
          email: form.email,
          shipping: {
            name: form.name,
            phone: form.phone,
            service: form.service,
            city: city.picked?.withType ?? city.text,
            street: street.picked?.withType ?? street.text,
            house: house.picked?.withType ?? house.text,
            extra: form.extra,
            postal: house.picked?.postal,
          },
        }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        const invalid = orderData.error?.fieldErrors;
        throw new Error(
          invalid?.shipping ? t.invalidShipping : typeof orderData.error === "string" ? orderData.error : t.invalidShipping,
        );
      }

      // Payment is disabled for now — the order is pushed to lab on creation and handled from there.
      router.push(`/order/thank-you?orderId=${orderData.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-bold text-text">{t.title}</h1>

      <div className="card mt-6 flex items-baseline justify-between p-4">
        <span className="text-sm text-muted">{t.orderTotal}</span>
        <span className="text-xl font-bold text-text">
          {quote ? formatCents(quote.totalPriceCents, dict.locale) : "…"}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <Field label={t.email} type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        <Field label={t.fullName} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <Field
          label={t.phone}
          type="tel"
          placeholder="+7 900 000-00-00"
          pattern="[\d\s+()\-]{10,}"
          value={form.phone}
          onChange={(v) => setForm({ ...form, phone: v })}
        />

        <div>
          <label className="block text-sm font-medium text-text">{t.deliveryService}</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {DELIVERY_SERVICES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setForm({ ...form, service: s })}
                className={`pill ${form.service === s ? "active" : ""}`}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{t.deliveryHint}</p>
        </div>

        <AddressField
          label={t.city}
          level="city"
          placeholder={t.cityPlaceholder}
          value={city.text}
          onChange={(text) => setCity({ text, picked: null })}
          onSelect={(s) => {
            setCity({ text: s.value, picked: s });
            // A different city — the street and house typed for the old one no longer apply.
            if (s.value !== city.picked?.value) {
              setStreet({ text: "", picked: null });
              setHouse({ text: "", picked: null });
            }
          }}
        />
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
          <AddressField
            label={t.street}
            level="street"
            placeholder={t.streetPlaceholder}
            value={street.text}
            // Without a picked city the lookup would search the whole country — typing only.
            suggest={Boolean(city.picked)}
            context={{ cityId: city.picked?.id, cityName: city.picked?.value, bbox: city.picked?.bbox }}
            onChange={(text) => setStreet({ text, picked: null })}
            onSelect={(s) => {
              setStreet({ text: s.withType, picked: s });
              setHouse({ text: "", picked: null });
            }}
          />
          <AddressField
            label={t.house}
            level="house"
            placeholder="5"
            value={house.text}
            suggest={Boolean(street.picked)}
            context={{ streetId: street.picked?.id, streetName: street.picked?.value, bbox: city.picked?.bbox }}
            onChange={(text) => setHouse({ text, picked: null })}
            onSelect={(s) => setHouse({ text: s.value, picked: s })}
          />
        </div>
        <Field
          label={t.extra}
          placeholder={t.extraPlaceholder}
          required={false}
          value={form.extra}
          onChange={(v) => setForm({ ...form, extra: v })}
        />

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
  placeholder,
  pattern,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  pattern?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text">{label}</label>
      <input
        required={required}
        type={type}
        placeholder={placeholder}
        pattern={pattern}
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
