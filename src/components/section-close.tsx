"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { PepTalkMark } from "./logo-marks";

/**
 * The close.
 *
 * A page that ends on its last argument leaves the reader with nowhere to go,
 * and this one ended on a paragraph about retrieval. So: the ask, then the
 * wordmark run huge and cropped by the bottom of the page.
 *
 * The crop is doing real work rather than being a flourish. Type at this size
 * cannot be read as a word, it is read as a shape, and a shape that runs off
 * the edge implies the page continues past what is shown. That is the note to
 * end on for a product whose whole claim is that it keeps going after the
 * game finishes.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

export function SectionClose() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-20% 0px" });

  return (
    <section className="relative overflow-hidden bg-canvas pt-20 lg:pt-28">
      <div ref={ref} className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={seen ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <p className="font-mono text-[11px] tracking-[0.16em] text-accent uppercase">
            06 — your turn
          </p>
          <h2 className="mt-4 max-w-3xl text-[34px] leading-[1.08] font-medium tracking-[-0.02em] text-chalk sm:text-[46px]">
            Open it on the World Cup final.
          </h2>
          <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-warm-2">
            Same build, same data, nothing staged. Point it at your own team by
            editing one file.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href="/dashboard"
              className="rounded-lg bg-accent px-5 py-2.5 text-[14px] font-medium text-canvas transition-all hover:brightness-110"
            >
              Open the session
            </a>
            <a
              href="https://github.com/SankrityaT/PepTalk"
              className="rounded-lg px-5 py-2.5 text-[14px] text-warm ring-1 ring-white/[0.12] transition-colors hover:bg-white/[0.05] hover:text-chalk"
            >
              Read the code
            </a>
            <span className="ml-1 font-mono text-[11px] text-muted-2">
              built on HydraDB · data by StatsBomb
            </span>
          </div>
        </motion.div>
      </div>

      {/* The wordmark, oversized and cropped by the bottom of the page. */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={seen ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 1, delay: 0.15, ease: EASE }}
        aria-hidden
        className="pointer-events-none mt-16 flex select-none items-end justify-center gap-[2vw] lg:mt-24"
        // Cropped deliberately: the descender sits below the viewport, which is
        // what makes it read as a shape rather than a heading.
        style={{ marginBottom: "-3.5vw" }}
      >
        <span className="flex items-end gap-[2.2vw]">
          {/* size drives the mark's internal detail tier, so it is set to the
              rendered size rather than left at the 24px default and scaled. */}
          <PepTalkMark size={180} className="h-[13vw] w-[13vw] text-accent/80" />
          <span className="font-display text-[16vw] leading-[0.76] tracking-[-0.04em] text-chalk/[0.09]">
            Pep Talk
          </span>
        </span>
      </motion.div>
    </section>
  );
}
