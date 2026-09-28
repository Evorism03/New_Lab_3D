import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";

import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { YANDEX_METRIKA_ID, YandexMetrika } from "@/components/YandexMetrika";
import { BRAND_NAME } from "@/lib/brand";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = getDictionary(await getServerLocale());
  return {
    title: `${BRAND_NAME} — ${meta.titleSuffix}`,
    description: meta.description,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getServerLocale();
  return (
    <html lang={locale} className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <Providers>
          <Header />
          <main className="flex-1">{children}</main>
        </Providers>
        {/* useSearchParams needs a Suspense boundary, or every page would render client-side only. */}
        <Suspense fallback={null}>
          <YandexMetrika />
        </Suspense>
        <noscript>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element -- tracking pixel for visitors without JS */}
            <img
              src={`https://mc.yandex.ru/watch/${YANDEX_METRIKA_ID}`}
              style={{ position: "absolute", left: "-9999px" }}
              alt=""
            />
          </div>
        </noscript>
      </body>
    </html>
  );
}
