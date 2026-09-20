"use client";

import { useEffect, useRef } from "react";

import {
  getViewportSize,
  HERO_BAND_HEIGHT_VH,
  HERO_BAND_TOP_VH,
  HERO_PARALLAX_FACTOR,
  HERO_ROTATE_DEG,
  heroShapeBox,
} from "@/lib/heroShape";

// Where (fraction of viewport height) the band's centre ends up at the very
// bottom of the page.
const END_CENTRE_VH = 0.9;
const START_CENTRE_VH = HERO_BAND_TOP_VH + HERO_BAND_HEIGHT_VH / 2;

/** The continuation of the hero's green diamond below the dark section.
 *  It has the hero band's exact size, angle and position, follows the same
 *  parallax while the hero is on screen, then eases down to the bottom of the
 *  viewport over the rest of the page. It is clipped to the dark section, so
 *  it only shows where that section covers the hero band. Its tint is
 *  strongest on the two edges and fades toward the centre. */
export function PageBand() {
  const rootRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    function update() {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const root = rootRef.current;
        const band = bandRef.current;
        const section = root?.parentElement;
        if (!root || !band || !section) return;

        const viewport = getViewportSize();
        const vh = viewport.height;
        const box = heroShapeBox(viewport.width, vh);
        band.style.left = `${box.left}px`;
        band.style.top = `${box.top}px`;
        band.style.width = `${box.width}px`;
        band.style.height = `${box.height}px`;
        const y = window.scrollY;
        const heroHeight = document.getElementById("hero")?.offsetHeight ?? 0;
        const maxScroll = document.documentElement.scrollHeight - vh;
        const span = Math.max(1, maxScroll - heroHeight);

        let translate: number;
        if (y <= heroHeight) {
          translate = y * HERO_PARALLAX_FACTOR;
        } else {
          const atHandoff = heroHeight * HERO_PARALLAX_FACTOR;
          const distance = Math.max(0, (END_CENTRE_VH - START_CENTRE_VH) * vh - atHandoff);
          const progress = Math.min(1, (y - heroHeight) / span);
          // Decelerating curve whose starting speed matches the hero parallax.
          const power = distance > 0 ? Math.min(6, Math.max(1, (HERO_PARALLAX_FACTOR * span) / distance)) : 1;
          translate = atHandoff + distance * (1 - Math.pow(1 - progress, power));
        }

        band.style.transform = `translateY(${translate}px) rotate(${HERO_ROTATE_DEG}deg)`;

        const edge = Math.max(0, section.getBoundingClientRect().top);
        root.style.clipPath = `inset(${edge}px 0 0 0)`;
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
    <div
      ref={rootRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div
        ref={bandRef}
        className="absolute"
        style={{
          left: "-20%",
          width: "140%",
          top: `${HERO_BAND_TOP_VH * 100}vh`,
          height: `${HERO_BAND_HEIGHT_VH * 100}vh`,
          transform: `rotate(${HERO_ROTATE_DEG}deg)`,
          borderTop: "1px solid rgba(127, 191, 127, 0.4)",
          borderBottom: "1px solid rgba(127, 191, 127, 0.4)",
          background:
            "linear-gradient(to bottom, rgba(127, 191, 127, 0.16), rgba(127, 191, 127, 0) 50%, rgba(127, 191, 127, 0.16))",
        }}
      />
    </div>
  );
}
