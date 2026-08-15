"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PITCH_H, PITCH_W } from "./chalk-pitch";
import { handArrow, seededRandom } from "@/lib/hand-drawn";
import { TACTICAL_STATES } from "@/content/hero";

/**
 * The coach's markings, redrawn per era.
 *
 * The pitch lines draw once and then sit still. These don't: every time the
 * scrub crosses into a new era the old arrows are wiped and the new ones are
 * drawn on, stroke by stroke. That keeps something visibly being sketched
 * throughout the hero rather than one draw-on at page load, and it is also
 * honest about what changed, since the arrows are per-era tactical facts.
 */

const pct = (p: { x: number; y: number }) => ({
  x: (p.x / 100) * PITCH_W,
  y: (p.y / 100) * PITCH_H,
});

export function EraAnnotations({ index }: { index: number }) {
  const state = TACTICAL_STATES[index];

  const arrows = useMemo(() => {
    // Seed off the era so each era's hand-wobble is its own, but stable.
    const rand = seededRandom(4200 + index * 97);
    return state.arrows.map((a) => {
      const from = pct(a.from);
      const to = pct(a.to);
      return {
        d: handArrow(from.x, from.y, to.x, to.y, rand, 26),
        accent: a.accent ?? false,
      };
    });
  }, [index, state.arrows]);

  return (
    <svg
      viewBox={`0 0 ${PITCH_W} ${PITCH_H}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <AnimatePresence mode="wait">
        <motion.g
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.28 } }}
          fill="none"
          strokeWidth={3}
          className="chalk-stroke"
        >
          {arrows.map((arrow, i) => (
            <motion.path
              key={`${index}-${i}`}
              d={arrow.d}
              stroke={arrow.accent ? "var(--color-accent)" : "currentColor"}
              opacity={arrow.accent ? 0.95 : 0.55}
              pathLength={1}
              strokeDasharray={1}
              initial={{ strokeDashoffset: 1 }}
              animate={{ strokeDashoffset: 0 }}
              transition={{
                duration: 0.85,
                delay: 0.12 + i * 0.16,
                ease: [0.4, 0, 0.2, 1],
              }}
            />
          ))}
        </motion.g>
      </AnimatePresence>
    </svg>
  );
}
