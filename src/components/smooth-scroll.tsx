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

    const lenis = new Lenis({
      duration: 1.1,
      smoothWheel: true,
      // Lenis takes the scroll position over, which quietly breaks every
      // same-page link on the site: "the product" in the header did nothing
      // at all, because the browser's own hash jump is a scroll and Lenis owns
      // scrolling now. This hands anchors back to it.
      //
      // No offset: Lenis does honour `scroll-mt`, and adding one on top of it
      // stacked the two and dropped the target 152px down the page instead of
      // the 80 the class asks for.
      anchors: true,
    });

    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    // Lenis measures the page once and keeps that number. This page finishes
    // growing after images and a video have loaded, so the scroll limit was
    // whatever the height had been at boot and the last section could not be
    // reached at all. Re-measure whenever the document changes size.
    const remeasure = new ResizeObserver(() => lenis.resize());
    remeasure.observe(document.documentElement);
    remeasure.observe(document.body);
    window.addEventListener("load", () => lenis.resize());

    return () => {
      cancelAnimationFrame(frame);
      remeasure.disconnect();
      lenis.destroy();
    };
  }, []);

  return null;
}
