"use client";

import { useEffect, useRef } from "react";

/** Wraps children in a layer that drifts as the page scrolls — a
 *  scroll-linked parallax (not mouse-driven). Stays fully visible; it never
 *  fades out. */
export function ScrollParallax({
  children,
  factor = -0.18,
  className,
}: {
  children: React.ReactNode;
  factor?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    function handleScroll() {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        if (ref.current) {
          const y = window.scrollY;
          ref.current.style.transform = `translateY(${y * factor}px)`;
        }
      });
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [factor]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
