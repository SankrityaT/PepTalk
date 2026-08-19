"use client";

import { useRef } from "react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { CLAIM_COPY, TACTICAL_STATES } from "@/content/hero";
import { MiniBoard } from "./mini-board";

/**
 * Section 02: the claim.
 *
 * The page's one full-bleed orange band, and the whole section is scrubbed
 * rather than played: the reader drives it.
 *
 * The sequence, as a fraction of the section's scroll:
 *
 *   the band arrives by this section scrolling over the sticky hero
 *   0.15 - 0.45  the sentence reveals, line by line
 *   0.40 - 0.55  a rule strikes through each era name in turn
 *   0.30 - 0.62  the two boards separate out, 2011 above and 2021 below
 *   0.62 - 0.86  they slide together and superimpose
 *   0.80 - 1.00  the verdict lands on the merged, unreadable average
 *
 * The merge is the argument. A vector store returns the mean of the two
 * shapes, and once they are on top of each other you can see that the mean
 * describes neither. That is a thing to show, not to assert, which is why
 * the section carries boards rather than an illustration.
 */

const [GUARDIOLA, , KOEMAN] = TACTICAL_STATES;

/** A line of the claim, revealed across its own slice of the scrub. */
function Line({
  progress,
  from,
  to,
  children,
  className,
}: {
  progress: ReturnType<typeof useSpring>;
  from: number;
  to: number;
  children: React.ReactNode;
  className?: string;
}) {
  const opacity = useTransform(progress, [from, to], [0, 1]);
  const y = useTransform(progress, [from, to], [22, 0]);
  return (
    <motion.span style={{ opacity, y }} className={`block ${className ?? ""}`}>
      {children}
    </motion.span>
  );
}

/** An era name with a rule that strikes across it on scroll. */
function Era({
  progress,
  from,
  to,
  children,
}: {
  progress: ReturnType<typeof useSpring>;
  from: number;
  to: number;
  children: string;
}) {
  const scaleX = useTransform(progress, [from, to], [0, 1]);
  return (
    <span className="relative inline-block whitespace-nowrap">
      {children}
      <motion.span
        aria-hidden="true"
        style={{ scaleX }}
        className="absolute top-[0.58em] left-0 block h-[0.07em] w-full origin-left bg-canvas"
      />
    </span>
  );
}

export function SectionClaim() {
  const ref = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  // Spring-smoothed so the boards glide between positions rather than
  // tracking raw wheel deltas, matching the hero's scrub.
  const p = useSpring(scrollYProgress, {
    stiffness: 110,
    damping: 30,
    mass: 0.4,
  });

  // Boards separate, then converge.
  //
  // Vertically, not horizontally: the boards live in a five-column lane
  // roughly 480px wide, and a horizontal spread wide enough to read pushed
  // the second board clean off the right edge of the viewport. The column
  // has height to spare and none to spare across.
  const topY = useTransform(p, [0.3, 0.62, 0.86], ["-3%", "-58%", "0%"]);
  const bottomY = useTransform(p, [0.3, 0.62, 0.86], ["3%", "58%", "0%"]);
  const boardsOpacity = useTransform(p, [0.28, 0.42], [0, 1]);

  // Once superimposed, both drop to a wash. Neither shape is legible, which
  // is the point being made.
  const mergedOpacity = useTransform(p, [0.66, 0.9], [1, 0.5]);
  const eyebrowOpacity = useTransform(p, [0.1, 0.2], [0, 1]);
  const footnoteOpacity = useTransform(p, [0.88, 1], [0, 1]);
  const labelOpacity = useTransform(p, [0.6, 0.72], [1, 0]);
  const averageLabelOpacity = useTransform(p, [0.84, 0.95], [0, 1]);

  return (
    <section
      ref={ref}
      id="the-claim"
      aria-label={CLAIM_COPY.label}
      // Tall enough that the whole sequence has room to breathe. The inner
      // panel is sticky, so this height is scrub distance, not layout.
      className="relative h-[320vh]"
    >
      {/* The hero above is sticky, so this section scrolling up over it is
          already the wipe. Transforming a band inside this sticky child on
          top of that moved it twice and fought the handoff. */}
      <div className="sticky top-0 h-screen overflow-hidden bg-accent">
        <div className="relative mx-auto grid h-full w-full max-w-6xl grid-cols-1 content-center items-center gap-6 px-5 text-canvas sm:gap-10 sm:px-10 lg:grid-cols-12">
          {/* ── The sentence ─────────────────────────────────────── */}
          <div className="lg:col-span-7">
            <motion.div
              style={{ opacity: eyebrowOpacity }}
              className="flex items-center gap-3"
            >
              <span
                aria-hidden
                className="pointer-events-none select-none font-display text-[72px] leading-none tracking-[-0.04em] text-canvas/[0.16] sm:text-[104px]"
              >
                {CLAIM_COPY.index}
              </span>
            </motion.div>

            <blockquote className="mt-8">
              <p className="font-display text-[1.5rem] leading-[1.16] tracking-[-0.01em] sm:text-[2.4rem] lg:text-[3rem]">
                <Line progress={p} from={0.15} to={0.26}>
                  {CLAIM_COPY.lead}
                </Line>
                <Line progress={p} from={0.22} to={0.34}>
                  <Era progress={p} from={0.4} to={0.5}>
                    {CLAIM_COPY.subjectA}
                  </Era>{" "}
                  {CLAIM_COPY.middle}
                </Line>
                <Line progress={p} from={0.28} to={0.4}>
                  <Era progress={p} from={0.46} to={0.56}>
                    {CLAIM_COPY.subjectB}
                  </Era>{" "}
                  {CLAIM_COPY.tail}
                </Line>
              </p>

              <Line
                progress={p}
                from={0.8}
                to={0.92}
                className="mt-5 font-display text-[1.5rem] leading-[1.16] tracking-[-0.01em] sm:text-[2.4rem] lg:text-[3rem]"
              >
                {CLAIM_COPY.punchline}
              </Line>
            </blockquote>

            <motion.div
              style={{ opacity: footnoteOpacity }}
              className="mt-8 max-w-lg space-y-3"
            >
              <p className="text-[13px] leading-relaxed text-canvas/70 sm:text-[15px]">
                {CLAIM_COPY.footnote}
              </p>
              {/* The punchline is a claim until this line pays it off, so it
                  gets the weight rather than sitting in the same grey as the
                  failure it answers. */}
              <p className="border-l-2 border-canvas/30 pl-4 text-[13px] leading-relaxed font-medium text-canvas sm:text-[15px]">
                {CLAIM_COPY.answer}
              </p>
            </motion.div>
          </div>

          {/* ── The boards ───────────────────────────────────────── */}
          <motion.div
            style={{ opacity: boardsOpacity }}
            className="relative lg:col-span-5"
          >
            <div className="relative mx-auto aspect-[420/272] w-full max-w-[13rem] sm:max-w-sm">
              <motion.div
                style={{ y: topY, opacity: mergedOpacity }}
                className="absolute inset-0"
              >
                <MiniBoard state={GUARDIOLA} seed={9111} className="h-full w-full" />
                <motion.span
                  style={{ opacity: labelOpacity }}
                  className="absolute -top-5 left-0 font-mono text-[10px] uppercase tracking-[0.14em] text-canvas/70"
                >
                  {GUARDIOLA.year} / {GUARDIOLA.era}
                </motion.span>
              </motion.div>

              <motion.div
                style={{ y: bottomY, opacity: mergedOpacity }}
                className="absolute inset-0"
              >
                <MiniBoard state={KOEMAN} seed={2021} className="h-full w-full" />
                <motion.span
                  style={{ opacity: labelOpacity }}
                  className="absolute -bottom-5 left-0 font-mono text-[10px] uppercase tracking-[0.14em] text-canvas/70"
                >
                  {KOEMAN.year} / {KOEMAN.era}
                </motion.span>
              </motion.div>

              {/* What the reader is left looking at once they overlap. */}
              <motion.span
                style={{ opacity: averageLabelOpacity }}
                className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-center font-mono text-[10px] whitespace-nowrap uppercase tracking-[0.14em] text-canvas"
              >
                What similarity returns
              </motion.span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
