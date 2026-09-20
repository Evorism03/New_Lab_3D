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
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    function update() {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const wrap = wrapRef.current;
        const dark = darkRef.current;
        if (!wrap || !dark) return;

        const viewport = getViewportSize();
        const corners = heroShapeCorners(window.scrollY, viewport.width, viewport.height);
        const wrapRect = wrap.getBoundingClientRect();
        const points = corners
          .map(([x, y]) => `${x - wrapRect.left}px ${y - wrapRect.top}px`)
          .join(", ");
        dark.style.clipPath = `polygon(${points})`;
      });
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
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
