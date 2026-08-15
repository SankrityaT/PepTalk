"use client";

import { useEffect } from "react";
import Lenis from "lenis";

/**
 * Lenis smooth scroll.
 *
 * The hero's time-travel scrub is driven by scroll position, and native
 * wheel scrolling arrives in coarse jumps that make the formation morph
 * look stepped. Lenis interpolates between them so the players glide.
 *
 * Disabled entirely under prefers-reduced-motion, hijacking scroll is
 * exactly the kind of thing that setting is asking us not to do.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });

    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return null;
}
