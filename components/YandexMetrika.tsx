"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export const YANDEX_METRIKA_ID = 109081361;

// Options of the counter code from Metrika; defer: true turns off its own page-view counting —
// on an SPA every page view (the first one too) is sent explicitly with "hit", as Yandex's
// "SPA sites" guide says.
const OPTIONS = {
  defer: true,
  ssr: true,
  webvisor: true,
  clickmap: true,
  ecommerce: "dataLayer",
  accurateTrackBounce: true,
  trackLinks: true,
};

// Admin screens (orders, customers' data) must not end up in Webvisor recordings.
const isPrivate = (path: string) => path.startsWith("/admin") || path.startsWith("/login");

type Ym = ((id: number, method: string, ...args: unknown[]) => void) & { a?: unknown[][]; l?: number };

declare global {
  interface Window {
    ym?: Ym;
  }
}

// The official loader: a queueing stub right away, tag.js fetched async (once).
function loadMetrika(): Ym {
  if (!window.ym) {
    const stub: Ym = (...args: unknown[]) => {
      (stub.a = stub.a || []).push(args);
    };
    stub.l = Date.now();
    window.ym = stub;
    const src = `https://mc.yandex.ru/metrika/tag.js?id=${YANDEX_METRIKA_ID}`;
    if (![...document.scripts].some((s) => s.src === src)) {
      const script = document.createElement("script");
      script.async = true;
      script.src = src;
      document.head.appendChild(script);
    }
  }
  return window.ym;
}

/**
 * Yandex.Metrika counter for this SPA: init once with defer, then a "hit" for every page the
 * visitor sees. Going into the admin turns the counter off ("destruct"), coming back turns it on.
 */
export function YandexMetrika() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const url = `${pathname}${searchParams.size ? `?${searchParams}` : ""}`;
  const active = useRef(false);
  const previousUrl = useRef<string | null>(null);

  useEffect(() => {
    if (isPrivate(pathname)) {
      if (active.current) {
        window.ym?.(YANDEX_METRIKA_ID, "destruct");
        active.current = false;
      }
      return;
    }
    const ym = loadMetrika();
    if (!active.current) {
      ym(YANDEX_METRIKA_ID, "init", OPTIONS);
      active.current = true;
    }
    ym(YANDEX_METRIKA_ID, "hit", window.location.href, { referer: previousUrl.current ?? document.referrer });
    previousUrl.current = window.location.href;
  }, [url, pathname]);

  return null;
}
