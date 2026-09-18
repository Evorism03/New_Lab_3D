"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { LOCALES, type Locale } from "@/lib/i18n/translations";

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const setLocale = (next: Locale) => {
    if (next === locale || isPending) return;
    fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).then(() => startTransition(() => router.refresh()));
  };

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 text-xs">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className={`rounded-md px-2 py-1 uppercase transition-colors ${
            locale === l ? "bg-accent-soft text-accent" : "text-muted hover:text-text"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
