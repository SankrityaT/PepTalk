"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { CLAIM_COPY } from "@/content/hero";

/**
 * Section 02: the claim.
 *
 * The page's one full-bleed orange band, spent on a single sentence. The
 * band is deliberately the loudest thing on the site and is used exactly
 * once, which is how HydraDB uses theirs.
 *
 * The motion is a strike-through: the two era names arrive underlined, then
 * a rule sweeps across them as the sentence resolves. Reading it should feel
 * like watching a claim get invalidated, because that is the argument.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

/**
 * An era name that gets struck through.
 *
 * Visibility is passed down from the section rather than each strike using
 * its own whileInView. Nested inside an already-animating parent, the inner
 * viewport detection fired inconsistently and only the second strike drew,
 * which read as a rendering bug rather than a choreographed one.
 */
function Era({
  children,
  delay,
  show,
}: {
  children: string;
  delay: number;
  show: boolean;
}) {
  return (
    <span className="relative inline-block whitespace-nowrap">
      {children}
      {/* The strike. Grows from the left once the phrase has landed. */}
      <motion.span
        aria-hidden="true"
        className="absolute left-0 top-[0.58em] block h-[0.07em] w-full origin-left bg-canvas"
        initial={{ scaleX: 0 }}
        animate={show ? { scaleX: 1 } : { scaleX: 0 }}
        transition={{ delay, duration: 0.55, ease: EASE }}
      />
    </span>
  );
}

export function SectionClaim() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });

  return (
    <section
      ref={ref}
      id="the-claim"
      aria-label={CLAIM_COPY.label}
      className="relative bg-accent text-canvas"
    >
      <div className="mx-auto w-full max-w-6xl px-5 py-24 sm:px-10 sm:py-32">
        {/* Numbered section label. HydraDB numbers every section and rules a
            thin line above the label; on the orange band the rule reads in
            black rather than accent. */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : undefined}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-3"
        >
          <span className="h-px w-8 bg-canvas/50" />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-canvas/70">
            {CLAIM_COPY.index} / {CLAIM_COPY.label}
          </span>
        </motion.div>

        <blockquote className="mt-10">
          <p className="font-display text-[1.75rem] leading-[1.16] tracking-[-0.01em] sm:text-[3rem] lg:text-[3.9rem]">
            <motion.span
              className="inline-block"
              initial={{ opacity: 0, y: 12 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.6, ease: EASE }}
            >
              {CLAIM_COPY.lead}{" "}
            </motion.span>
            <motion.span
              className="inline-block"
              initial={{ opacity: 0, y: 12 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{ delay: 0.12, duration: 0.6, ease: EASE }}
            >
              <Era delay={0.95} show={inView}>
                {CLAIM_COPY.subjectA}
              </Era>{" "}
              {CLAIM_COPY.middle}{" "}
              <Era delay={1.12} show={inView}>
                {CLAIM_COPY.subjectB}
              </Era>{" "}
            </motion.span>
            <motion.span
              className="inline-block"
              initial={{ opacity: 0, y: 12 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{ delay: 0.24, duration: 0.6, ease: EASE }}
            >
              {CLAIM_COPY.tail}
            </motion.span>
          </p>

          {/* The punchline lands after the strike completes, so the rhythm is
              claim, invalidation, verdict. */}
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ delay: 1.5, duration: 0.6, ease: EASE }}
            className="mt-6 font-display text-[1.75rem] leading-[1.16] tracking-[-0.01em] sm:text-[3rem] lg:text-[3.9rem]"
          >
            {CLAIM_COPY.punchline}
          </motion.p>
        </blockquote>

        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : undefined}
          transition={{ delay: 1.85, duration: 0.7 }}
          className="mt-12 max-w-xl text-[13px] leading-relaxed text-canvas/75 sm:text-[15px]"
        >
          {CLAIM_COPY.footnote}
        </motion.p>
      </div>
    </section>
  );
}
