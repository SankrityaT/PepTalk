"use client";

import { motion } from "motion/react";
import { Moment } from "@/content/pep";

/**
 * The moment, frozen.
 *
 * Every dot is a real player at the instant the ball was struck, from
 * StatsBomb's 360 freeze frame. Nothing here is arranged for the picture.
 *
 * This replaces the paragraph that used to sit here, and it is a better
 * argument than the paragraph was: the whole claim is "someone better was
 * open", and a coach can verify that claim in half a second by looking at
 * where the shirts are. Prose asks them to take it on trust.
 *
 * Two passes are drawn. The one played is dim and dashed. The one that was on
 * is accent, solid, and ends in a ring around the man who was free.
 */

const L = 120;
const W = 80;

const EASE = [0.4, 0, 0.2, 1] as const;

function Pitch() {
  return (
    <g fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={0.4}>
      <rect x={0} y={0} width={L} height={W} />
      <line x1={L / 2} y1={0} x2={L / 2} y2={W} />
      <circle cx={L / 2} cy={W / 2} r={10} />
      <rect x={0} y={18} width={18} height={44} />
      <rect x={L - 18} y={18} width={18} height={44} />
      <rect x={0} y={30} width={6} height={20} />
      <rect x={L - 6} y={30} width={6} height={20} />
    </g>
  );
}

export function MomentFrame({
  moment,
  compact = false,
}: {
  moment: Moment;
  /** Card-sized: drops the legend and the labels. */
  compact?: boolean;
}) {
  const freeze = moment.freeze ?? [];
  const [fx, fy] = moment.from;
  const [px, py] = moment.played_to;
  const [bx, by] = moment.best_to;

  const r = compact ? 1.5 : 1.8;

  return (
    <svg
      viewBox={`-2 -2 ${L + 4} ${W + 4}`}
      className="w-full rounded-md bg-pitch ring-1 ring-white/[0.07]"
    >
      <Pitch />

      {/* ── Everyone on the pitch ─────────────────────────────────────── */}
      {freeze.map((p, i) => {
        if (p.actor) return null;
        return (
          <motion.circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={p.keeper ? r * 0.9 : r}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.05 + i * 0.012, ease: EASE }}
            fill={p.mate ? "rgba(216,210,204,0.92)" : "transparent"}
            stroke={p.mate ? "none" : "rgba(216,210,204,0.42)"}
            strokeWidth={0.7}
          />
        );
      })}

      {/* ── The ball that was played ──────────────────────────────────── */}
      <motion.line
        x1={fx}
        y1={fy}
        x2={px}
        y2={py}
        stroke="rgba(216,210,204,0.5)"
        strokeWidth={0.7}
        strokeDasharray="2.5 2"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, delay: 0.25, ease: EASE }}
      />

      {/* ── The ball that was on ──────────────────────────────────────── */}
      <motion.line
        x1={fx}
        y1={fy}
        x2={bx}
        y2={by}
        stroke="var(--color-accent)"
        strokeWidth={1.3}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, delay: 0.5, ease: EASE }}
      />
      <motion.circle
        cx={bx}
        cy={by}
        r={3.6}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={0.9}
        initial={{ opacity: 0, scale: 1.7 }}
        animate={{ opacity: 1, scale: 1 }}
        style={{ transformOrigin: `${bx}px ${by}px` }}
        transition={{ duration: 0.35, delay: 0.9, ease: EASE }}
      />

      {/* ── The man on the ball ───────────────────────────────────────── */}
      <circle cx={fx} cy={fy} r={r + 0.7} fill="#ffffff" />

      {!compact && (
        <g className="font-mono" fontSize={3.4} fill="rgba(216,210,204,0.75)">
          <text x={px + 5} y={py + 1.2}>
            played
          </text>
          <text x={bx + 6} y={by + 1.2} fill="var(--color-accent)">
            was on
          </text>
        </g>
      )}
    </svg>
  );
}
