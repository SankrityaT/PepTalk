"use client";

import { useMemo } from "react";
import { handArc, handLine, handRect, seededRandom } from "@/lib/hand-drawn";
import type { TacticalState } from "@/content/hero";

/**
 * A small tactical board for one era.
 *
 * Deliberately not the hero's <ChalkPitch>: at this size the penalty arcs
 * and six-yard boxes turn to noise, and the whole point is that the reader
 * compares two shapes at a glance. Boundary, halfway, centre circle, eleven
 * marks, press line. Nothing else.
 *
 * Strokes use currentColor so the same component works on the black canvas
 * and on the orange band.
 */

const W = 420;
const H = 272;

export function MiniBoard({
  state,
  seed,
  showPressLine = true,
  className,
}: {
  state: TacticalState;
  /** Vary so two boards on screen do not have identical hand wobble. */
  seed: number;
  showPressLine?: boolean;
  className?: string;
}) {
  const pitch = useMemo(() => {
    const rand = seededRandom(seed);
    return [
      handRect(6, 6, W - 12, H - 12, rand, 2),
      handLine(W / 2, 6, W / 2, H - 6, rand, 1.8),
      handArc(W / 2, H / 2, 34, 0, Math.PI * 2, rand, 1.4),
    ].join(" ");
  }, [seed]);

  const pressX = (state.pressHeight / 105) * W;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d={pitch}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        opacity={0.4}
        strokeLinecap="round"
      />

      {showPressLine && (
        <line
          x1={pressX}
          y1={10}
          x2={pressX}
          y2={H - 10}
          stroke="currentColor"
          strokeWidth={2.5}
          strokeDasharray="6 7"
          opacity={0.75}
        />
      )}

      {state.players.map((p, i) => (
        <circle
          key={i}
          cx={(p.x / 100) * W}
          cy={(p.y / 100) * H}
          r={i === 0 ? 4.5 : 6}
          fill="currentColor"
          opacity={i === 0 ? 0.45 : 0.9}
        />
      ))}
    </svg>
  );
}

export { W as MINI_W, H as MINI_H };
