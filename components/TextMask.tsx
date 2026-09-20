"use client";

import { useEffect, useRef } from "react";

import { getViewportSize, heroShapeCorners } from "@/lib/heroShape";

/** Renders children twice — a light base copy and a dark copy clipped to
 *  wherever the hero's parallax shape currently overlaps it — so text turns
 *  dark exactly where the (invisible, for this purpose) shape covers it,
 *  and stays light everywhere else. The clip polygon is recomputed from the
 *  real shape geometry every scroll frame, so it can't drift out of sync. */
export function TextMask({
  children,
  className,
  lightClassName,
  darkClassName,
}: {
  children: React.ReactNode;
  className?: string;
  lightClassName?: string;
  darkClassName?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const darkRef = useRef<HTMLDivElement>(null);

  // The text moves on its own (reveal animation, scroll parallax) without any scroll or resize
  // event, so the clip is re-measured every frame instead of only on events.
  useEffect(() => {
    let frame = 0;
    let last = "";

    function tick() {
      frame = requestAnimationFrame(tick);
      const wrap = wrapRef.current;
      const dark = darkRef.current;
      if (!wrap || !dark) return;

      const viewport = getViewportSize();
      const wrapRect = wrap.getBoundingClientRect();
      if (wrapRect.bottom < -100 || wrapRect.top > viewport.height + 100) return;

      const corners = heroShapeCorners(window.scrollY, viewport.width, viewport.height);
      const points = corners
        .map(([x, y]) => `${(x - wrapRect.left).toFixed(2)}px ${(y - wrapRect.top).toFixed(2)}px`)
        .join(", ");
      if (points !== last) {
        last = points;
        dark.style.clipPath = `polygon(${points})`;
      }
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <div className={lightClassName}>{children}</div>
      <div
        ref={darkRef}
        aria-hidden
        className={`pointer-events-none absolute inset-0 ${darkClassName ?? ""}`}
      >
        {children}
      </div>
    </div>
  );
}
