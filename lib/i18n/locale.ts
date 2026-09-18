import { cookies } from "next/headers";

import { DEFAULT_LOCALE, LOCALES, type Locale } from "./translations";

export const LOCALE_COOKIE = "locale";

export async function getServerLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return (LOCALES as readonly string[]).includes(value ?? "") ? (value as Locale) : DEFAULT_LOCALE;
}
