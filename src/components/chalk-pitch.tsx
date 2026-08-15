"use client";

import { useMemo } from "react";
import { handArc, handLine, handRect, seededRandom } from "@/lib/hand-drawn";

/**
 * The pitch, drawn in chalk.
 *
 * Geometry is generated once from a fixed seed, so it is stable across
 * renders and identical on server and client. Lines draw themselves in via
 * stroke-dashoffset; each gets its own delay so the board fills the way
 * someone would actually draw it: boundary, then halfway, then the boxes,
 * then the goals.
 */

// Pitch is 105m x 68m; the viewBox keeps that ratio so metre-based values
// from the harness map onto it without a fudge factor.
export const PITCH_W = 1050;
export const PITCH_H = 680;

/**
 * Distance from the viewBox edge to the touchline.
 *
 * Non-zero so the goal frames have somewhere to sit. They hang outside the
 * goal line, the way they do on a real pitch.
 */
export const INSET = 30;

/** Goal mouth is 7.32m of a 68m width. */
const GOAL_H = (7.32 / 68) * PITCH_H;
const GOAL_DEPTH = 22;

type ChalkPitchProps = {
  /** Set false to skip the draw-on animation (reduced motion, or re-entry). */
  animate?: boolean;
  className?: string;
};

export function ChalkPitch({ animate = true, className }: ChalkPitchProps) {
  const paths = useMemo(() => {
    const rand = seededRandom(20111121);

    const right = PITCH_W - INSET;
    const boxDepth = 165; // 16.5m
    const boxWidth = 403; // 40.3m
    const sixDepth = 55;
    const sixWidth = 183;
    const boxTop = (PITCH_H - boxWidth) / 2;
    const sixTop = (PITCH_H - sixWidth) / 2;
    const goalTop = (PITCH_H - GOAL_H) / 2;

    return [
      // Outer boundary, drawn first, longest delay budget.
      {
        d: handRect(INSET, INSET, PITCH_W - INSET * 2, PITCH_H - INSET * 2, rand, 3.2),
        delay: 0,
      },
      // Halfway line.
      {
        d: handLine(PITCH_W / 2, INSET, PITCH_W / 2, PITCH_H - INSET, rand, 2.8),
        delay: 0.55,
      },
      // Centre circle.
      { d: handArc(PITCH_W / 2, PITCH_H / 2, 92, 0, Math.PI * 2, rand), delay: 0.75 },
      // Left penalty box + six-yard box.
      { d: handRect(INSET, boxTop, boxDepth, boxWidth, rand), delay: 1.0 },
      { d: handRect(INSET, sixTop, sixDepth, sixWidth, rand), delay: 1.2 },
      // Right penalty box + six-yard box.
      {
        d: handRect(right - boxDepth, boxTop, boxDepth, boxWidth, rand),
        delay: 1.1,
      },
      {
        d: handRect(right - sixDepth, sixTop, sixDepth, sixWidth, rand),
        delay: 1.3,
      },
      // Penalty arcs.
      {
        d: handArc(INSET + 110, PITCH_H / 2, 92, -Math.PI * 0.36, Math.PI * 0.36, rand),
        delay: 1.4,
      },
      {
        d: handArc(
          right - 110,
          PITCH_H / 2,
          92,
          Math.PI * 0.64,
          Math.PI * 1.36,
          rand,
        ),
        delay: 1.45,
      },
      // Goal frames, hanging off each goal line. Drawn last, the way a coach
      // adds them once the pitch itself is down.
      {
        d: handRect(INSET - GOAL_DEPTH, goalTop, GOAL_DEPTH, GOAL_H, rand, 1.6),
        delay: 1.6,
      },
      {
        d: handRect(right, goalTop, GOAL_DEPTH, GOAL_H, rand, 1.6),
        delay: 1.68,
      },
    ];
  }, []);

  return (
    <svg
      viewBox={`0 0 ${PITCH_W} ${PITCH_H}`}
      className={className}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Field tint.
          A near-black green rather than a green: at this value it reads as
          depth and warmth rather than as a colour, so the palette stays
          black plus one accent. Pushing it further starts competing with
          the orange press line for attention. */}
      <rect
        x={INSET}
        y={INSET}
        width={PITCH_W - INSET * 2}
        height={PITCH_H - INSET * 2}
        fill="var(--color-pitch)"
      />

      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        className="chalk-stroke"
      >
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            // pathLength normalises every path to 1 unit, so one dash value
            // works regardless of the path's real length.
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={animate ? 1 : 0}
            style={
              animate
                ? {
                    animation: `draw-on 1.5s var(--ease-ui) ${p.delay}s forwards`,
                  }
                : undefined
            }
          />
        ))}
      </g>
    </svg>
  );
}
