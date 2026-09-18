"use client";

import { useEffect, useRef } from "react";

import { HERO_BAND_HEIGHT_VH, HERO_BAND_TOP_VH, heroShapeTransform } from "@/lib/heroShape";

// Once scrolled past the hero section, the band fades out over this many
// extra pixels — short, so it never lingers as a muddy wash over the
// section below, but it stays fully visible for the whole hero first.
const FADE_DISTANCE = 150;

export function TiltFrame() {
  const shapeRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    function handleScroll() {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        if (shapeRef.current) {
          const heroHeight = document.getElementById("hero")?.offsetHeight ?? 0;
          const scrolledPastHero = Math.max(0, window.scrollY - heroHeight);
          const opacity = Math.max(0, 1 - scrolledPastHero / FADE_DISTANCE);
          shapeRef.current.style.transform = heroShapeTransform(window.scrollY);
          shapeRef.current.style.opacity = String(opacity);
        }
      });
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        id="hero-parallax-shape"
        ref={shapeRef}
        className="absolute"
        style={{
          left: "-20%",
          width: "140%",
          top: `${HERO_BAND_TOP_VH * 100}vh`,
          height: `${HERO_BAND_HEIGHT_VH * 100}vh`,
          background: "var(--accent)",
          transform: "rotate(-18deg)",
        }}
      />
    </div>
  );
}
