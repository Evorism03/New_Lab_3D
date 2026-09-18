import type { Locale } from "@/lib/i18n/translations";

/** All prices are stored in rubles (minor units = kopecks). The English site
 *  shows dollars converted at this rate; the Russian site shows rubles as is. */
export const RUB_PER_USD = Number(process.env.NEXT_PUBLIC_RUB_PER_USD) || 90;

/** Formats an amount given in rubles for the given site language. */
export function formatAmount(rub: number, locale: Locale): string {
  if (locale === "ru") {
    const isWhole = Math.round(rub * 100) % 100 === 0;
    return rub.toLocaleString("ru-RU", {
      style: "currency",
      currency: "RUB",
      minimumFractionDigits: isWhole ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }
  return (rub / RUB_PER_USD).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Formats an amount given in kopecks. */
export function formatCents(kopecks: number, locale: Locale): string {
  return formatAmount(kopecks / 100, locale);
}
