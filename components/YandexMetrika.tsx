"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

export const YANDEX_METRIKA_ID = 109081361;

// Admin screens (orders, customers' data) must not end up in Webvisor recordings.
const isPrivate = (path: string) => path.startsWith("/admin") || path.startsWith("/login");

declare global {
  interface Window {
    ym?: (id: number, method: string, ...args: unknown[]) => void;
  }
}

/**
 * Yandex.Metrika counter. The official snippet counts the first page view on init; pages opened
 * after that are client-side navigations, so each of them is reported with an explicit "hit".
 */
export function YandexMetrika() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const firstView = useRef(true);
  // Decided once, by the page the visitor opened first.
  const [landedOnPrivate] = useState(() => isPrivate(pathname));
  const url = `${pathname}${searchParams.size ? `?${searchParams}` : ""}`;

  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    if (!isPrivate(pathname)) window.ym?.(YANDEX_METRIKA_ID, "hit", window.location.href, { referer: document.referrer });
  }, [url, pathname]);

  // Opened straight on an admin page — the counter is not loaded at all.
  if (landedOnPrivate) return null;

  return (
    <Script id="yandex-metrika" strategy="afterInteractive">
      {`(function(m,e,t,r,i,k,a){
        m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
        m[i].l=1*new Date();
        for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
        k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
      })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=${YANDEX_METRIKA_ID}', 'ym');
      ym(${YANDEX_METRIKA_ID}, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});`}
    </Script>
  );
}
