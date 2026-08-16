"use client";

import { useMemo } from "react";
import {
  Mark,
  TrackedPlayer,
  defendingLeft,
  defensiveLine,
  mostSpace,
  movementArrows,
} from "@/lib/chalk-reads";
import { handArc, handArrow, handLine, seededRandom } from "@/lib/hand-drawn";

/**
 * Chalk, drawn on the frame itself.
 *
 * This is the thing a coach means by analysis: lines and circles on the
 * picture, not a diagram beside it. It went missing for a while because I went
 * looking for a pitch-to-image homography first, on the assumption that
 * anything drawn on a frame had to come from pitch coordinates.
 *
 * It does not. Every mark here is computed in the tracker's own normalised box
 * space: the defensive line runs through the players actually holding it, the
 * arrows are displacement players actually covered between two tracked frames,
 * the circle is the largest real gap between a player and the nearest
 * opponent. None of that needs to know where the pitch is, which is why it
 * worked before the detour and works now.
 *
 * Drawn with the hand-drawn primitives so it reads as chalk rather than as a
 * CAD overlay. The wobble is seeded per mark, so a line does not shimmer while
 * the video is paused on it.
 */

const VB_W = 1000;
const VB_H = 562;

/**
 * The hand-drawn helpers were calibrated for roughly thousand-unit viewboxes,
 * so the overlay is drawn at that scale and stretched, rather than drawn in
 * 0-1 space where the wobble would be larger than the marks.
 */
function sx(x: number): number {
  return x * VB_W;
}
function sy(y: number): number {
  return y * VB_H;
}

const TEAM_COLOUR = ["#7ec8f0", "var(--color-accent)"] as const;

export function ChalkOverlay({
  players,
  previous,
  team,
  show = { line: true, arrows: true, space: true },
  seed = 7,
}: {
  players: TrackedPlayer[];
  /** The frame before, for movement arrows. */
  previous?: TrackedPlayer[];
  /** Whose shape to draw. */
  team: number;
  show?: { line?: boolean; arrows?: boolean; space?: boolean };
  seed?: number;
}) {
  const marks = useMemo<Mark[]>(() => {
    if (players.length < 4) return [];
    const out: Mark[] = [];
    const left = defendingLeft(players, team);

    if (show.line) {
      const l = defensiveLine(players, team, left);
      if (l) out.push(l);
    }
    if (show.arrows && previous?.length) {
      // Signature is (prev, curr, minMove, maxMove). Passing `team` as the
      // third argument set the movement floor to 1.0 of frame width, which
      // silently discarded every arrow.
      out.push(...movementArrows(previous, players).filter((a) => a.team === team));
    }
    if (show.space) {
      const s = mostSpace(players, team === 0 ? 1 : 0);
      if (s) out.push(s);
    }
    return out;
  }, [players, previous, team, show.line, show.arrows, show.space]);

  if (!marks.length) return null;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      {marks.map((m, i) => {
        const rand = seededRandom(seed + i * 31);
        const colour = TEAM_COLOUR[m.team] ?? "#ffffff";

        if (m.kind === "line") {
          return (
            <g key={i} filter="url(#chalk)">
              <path
                d={handLine(sx(m.x1), sy(m.y1), sx(m.x2), sy(m.y2), rand)}
                stroke={colour}
                strokeWidth={3}
                fill="none"
                strokeLinecap="round"
                opacity={0.95}
              />
              <text
                x={sx((m.x1 + m.x2) / 2)}
                y={sy((m.y1 + m.y2) / 2) - 12}
                fill={colour}
                fontSize={17}
                fontFamily="var(--font-mono)"
                textAnchor="middle"
                opacity={0.9}
              >
                {m.label}
              </text>
            </g>
          );
        }

        if (m.kind === "arrow") {
          return (
            <path
              key={i}
              d={handArrow(sx(m.x1), sy(m.y1), sx(m.x2), sy(m.y2), rand)}
              stroke={colour}
              strokeWidth={2.4}
              fill="none"
              strokeLinecap="round"
              opacity={0.85}
              filter="url(#chalk)"
            />
          );
        }

        return (
          <g key={i} filter="url(#chalk)">
            <path
              d={handArc(sx(m.cx), sy(m.cy), m.r * VB_W, 0, Math.PI * 2, rand)}
              stroke={colour}
              strokeWidth={3}
              fill="none"
              opacity={0.95}
            />
            <text
              x={sx(m.cx)}
              y={sy(m.cy) - m.r * VB_W - 10}
              fill={colour}
              fontSize={17}
              fontFamily="var(--font-mono)"
              textAnchor="middle"
              opacity={0.9}
            >
              {m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
