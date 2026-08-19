"use client";

import { motion, useMotionValueEvent, useTransform } from "motion/react";
import { useState } from "react";
import { ChalkPitch } from "./chalk-pitch";
import { EraAnnotations } from "./era-annotations";
import { SiteNav } from "./site-nav";
import { TimeTravelPitch, useTimeTravelProgress } from "./time-travel-pitch";
import { HERO_COPY, TACTICAL_STATES } from "@/content/hero";
import { useEraIndex } from "@/lib/use-era-index";

/**
 * Section 01: Hero.
 *
 * Two viewports tall, pinned. The first screen is deliberately quiet: the
 * board, a wordmark, and one sentence, anchored to the bottom-left the way
 * PlayVision's hero is. Everything that explains the mechanism, the readout
 * card in particular, is held back until the reader starts scrolling, so
 * the opening frame makes one claim rather than six.
 */

const STATE_COUNT = TACTICAL_STATES.length;

type Progress = ReturnType<typeof useTimeTravelProgress>["progress"];

/** The year counter, scrubbing continuously rather than snapping. */
function YearScrubber({ progress }: { progress: Progress }) {
  const [year, setYear] = useState(String(TACTICAL_STATES[0].year));

  const yearValue = useTransform(
    progress,
    TACTICAL_STATES.map((_, i) => i / (STATE_COUNT - 1)),
    TACTICAL_STATES.map((s) => s.year),
  );

  useMotionValueEvent(yearValue, "change", (v) => {
    setYear(String(Math.round(v)));
  });

  return <span className="font-display text-accent tabular-nums">{year}</span>;
}

export function Hero() {
  const { ref, progress } = useTimeTravelProgress();
  const eraIndex = useEraIndex(progress);

  // The readout is the payoff, not the opening statement. It fades up as
  // soon as the reader commits to scrolling and stays for the rest of the
  // travel.
  const readoutOpacity = useTransform(progress, [0, 0.06, 0.16], [0, 0, 1]);
  const readoutY = useTransform(progress, [0, 0.16], [24, 0]);

  return (
    <section
      ref={ref}
      id="hero"
      // Two viewports of scroll gives the board room to travel without the
      // morph feeling rushed.
      className="relative h-[200vh]"
    >
      <div className="sticky top-0 h-screen overflow-hidden">
        <SiteNav />

        {/* ── The board ─────────────────────────────────────────────── */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative w-[150%] max-w-none sm:w-[104%]">
            <ChalkPitch className="h-auto w-full text-chalk opacity-45" />
            {/* Coach's arrows, wiped and redrawn on every era change. */}
            <div className="absolute inset-0 text-chalk">
              <EraAnnotations index={eraIndex} />
            </div>
            {/* Players and press line: full strength, they carry the claim. */}
            <div className="absolute inset-0">
              <TimeTravelPitch progress={progress} />
            </div>
          </div>
        </div>

        {/* Scrim. Bottom-weighted now that the copy lives at the bottom,
            and kept shallow because by 2021 the press line has dropped to
            33m, which puts it behind the text. */}
        {/* Reaches higher than it looks like it needs to. At shorter viewport
            heights the copy block rides up into the board, and a solid white
            ball landing behind the uppercase eyebrow is unreadable. */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,var(--color-canvas)_5%,rgba(0,0,0,0.9)_34%,rgba(0,0,0,0.55)_55%,transparent_78%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-canvas/80 to-transparent" />

        {/* ── The copy, anchored bottom-left ────────────────────────── */}
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-10 sm:pb-20">
            <div className="grid grid-cols-1 items-end gap-8 lg:grid-cols-12">
              <div className="lg:col-span-7">
                {/* No eyebrow. "Match tape / already watched" in ten pixel
                    mono was the same small grey label every landing page opens
                    with, and it was announcing the headline directly beneath
                    it rather than adding to it. The headline can carry the
                    hero on its own. */}

                <motion.h1
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.32,
                    duration: 0.8,
                    ease: [0.4, 0, 0.2, 1],
                  }}
                  className="mt-5 font-display text-[1.7rem] leading-[1.1] tracking-[-0.01em] text-chalk sm:text-[2.7rem] lg:text-[3.2rem]"
                >
                  {HERO_COPY.headline}
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.46,
                    duration: 0.8,
                    ease: [0.4, 0, 0.2, 1],
                  }}
                  // Hidden on mobile: there is only room for one explainer
                  // below the headline, and the readout card demonstrates
                  // the mechanism rather than describing it.
                  className="mt-5 hidden max-w-lg text-[13px] leading-relaxed text-muted sm:block sm:text-[15px]"
                >
                  {HERO_COPY.sub}
                </motion.p>
              </div>

              {/* ── The product, revealed on scroll ──────────────────── */}
              <motion.div
                style={{ opacity: readoutOpacity, y: readoutY }}
                className="mt-4 flex lg:col-span-5 lg:mt-0 lg:justify-end"
              >
                {/* What used to sit here was a retrieved fact rendered as a
                    schema browser: as_of, valid_from, superseded_by. That was
                    the right thing to show when there was no product to show,
                    and it is the wrong thing now. This is the session running,
                    recorded from the build the button below opens. */}
                <span className="relative block w-full overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.08] lg:max-w-[46rem]">
                  <video
                    className="block w-full"
                    src="/shots/session.mp4"
                    poster="/shots/session.webp"
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                  />
                  <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/[0.04]" />
                </span>
              </motion.div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
