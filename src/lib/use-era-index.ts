"use client";

import { useState } from "react";
import { useMotionValueEvent, type MotionValue } from "motion/react";
import { TACTICAL_STATES } from "@/content/hero";

const STATE_COUNT = TACTICAL_STATES.length;

/**
 * Snaps continuous scroll progress to the nearest tactical era.
 *
 * The board interpolates smoothly, but text and arrows must not: a claim
 * half-way between two eras is not a claim the graph would ever return.
 * Everything discrete reads from this.
 */
export function useEraIndex(progress: MotionValue<number>): number {
  const [index, setIndex] = useState(0);

  useMotionValueEvent(progress, "change", (value) => {
    const next = Math.min(
      STATE_COUNT - 1,
      Math.max(0, Math.round(value * (STATE_COUNT - 1))),
    );
    setIndex((current) => (current === next ? current : next));
  });

  return index;
}
