"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { HalftimeScreen } from "./halftime-screen";
import { GRAPH_FACTS, ISTANBUL, PIPELINE_STRIP } from "@/content/istanbul";

/**
 * Section 04: the product, on the match everyone remembers.
 *
 * An earlier version explained the pipeline in four stages of prose. That
 * was the page telling a judge how the product works instead of showing it
 * working, and it buried the one thing worth looking at. The clip and the
 * halftime screen now carry it: what actually happened, and what the
 * product would have put in front of the coach while it was happening.
 *
 * The pipeline survives as a four-word strip. That is all the explaining
 * the order needs.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-12%" },
  transition: { duration: 0.6, ease: EASE },
};

export function SectionHowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative border-t border-rule bg-canvas py-24 sm:py-32"
    >
      <div className="mx-auto w-full max-w-5xl px-5 sm:px-10">
        <motion.div {...reveal}>
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
              04 / How it works
            </span>
          </div>

          <h2 className="mt-6 max-w-3xl font-display text-[1.7rem] leading-[1.14] tracking-[-0.01em] text-chalk sm:text-[2.5rem]">
            You are three down at halftime.
          </h2>

          <p className="mt-5 max-w-lg text-[13px] leading-relaxed text-muted sm:text-[15px]">
            {ISTANBUL.label}, {ISTANBUL.date}. Every figure below is from the
            graph, which holds {GRAPH_FACTS.toLocaleString()} dated facts.
          </p>

          {/* The pipeline, in four words instead of four paragraphs. */}
          <div className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-2">
            {PIPELINE_STRIP.map((step, i) => (
              <span key={step} className="flex items-center gap-3">
                {i > 0 && <span className="text-accent/50">&rsaquo;</span>}
                {step}
              </span>
            ))}
          </div>
        </motion.div>

        {/* ── The bench. The situation. ─────────────────────────────── */}
        <motion.figure {...reveal} className="mt-12">
          <Image
            src="/img/halftime-bench.jpg"
            alt="A footballer sitting alone on a dressing-room bench at halftime, head down, a three-mark tally chalked on the wall behind him."
            width={1600}
            height={1067}
            className="w-full"
          />
        </motion.figure>

        {/* ── What the product shows the coach. ─────────────────────── */}
        <div className="mt-12">
          <HalftimeScreen />
        </div>

        {/* ── What actually happened next. ──────────────────────────── */}
        {/* Not broadcast footage. Every ball position is a real logged touch,
            and each goal holds on the true positions of every player on the
            pitch from the shot freeze frames. This is also what the CV
            pipeline emits, so it shows the product rather than borrowing
            someone's highlights. */}
        <motion.figure {...reveal} className="mt-14">
          <video
            className="w-full border border-rule"
            poster="/video/istanbul-comeback.jpg"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Bird's-eye reconstruction of Liverpool's three goals in six minutes, rebuilt from match event data."
          >
            <source src="/video/istanbul-comeback.webm" type="video/webm" />
            <source src="/video/istanbul-comeback.mp4" type="video/mp4" />
          </video>
          <figcaption className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-2">
            <span className="text-muted">Three goals in six minutes.</span>{" "}
            Reconstructed from event data, not footage.
          </figcaption>
        </motion.figure>

        {/* ── The point. ────────────────────────────────────────────── */}
        <motion.div {...reveal} className="mt-14 border-l-2 border-accent pl-6">
          <p className="max-w-2xl font-display text-[1.25rem] leading-[1.3] tracking-[-0.01em] text-chalk sm:text-[1.6rem]">
            They came back by sitting deeper, not by chasing the game.
          </p>
          <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-muted">
            Every instinct says attack harder when you are losing. The graph
            compared the half to what this team actually was in 2005, not to a
            general idea of how football works.
          </p>
        </motion.div>

        {/* ── The coach. ────────────────────────────────────────────── */}
        <motion.figure {...reveal} className="mt-14">
          <Image
            src="/img/coach-touchline.jpg"
            alt="A manager at the touchline mid-instruction, pointing across a chalk-drawn pitch."
            width={1600}
            height={1067}
            className="w-full"
          />
          <figcaption className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-2">
            Fifteen minutes. One thing to change.
          </figcaption>
        </motion.figure>
      </div>
    </section>
  );
}
