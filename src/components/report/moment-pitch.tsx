"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { handArc, handArrow, handLine, seededRandom } from "@/lib/hand-drawn";
import { Moment, surname } from "@/content/pep";

/**
 * One moment, drawn.
 *
 * The ball that was played, in chalk. The ball that was on, in accent. Nothing
 * else on the pitch, because the whole point is that the comparison should take
 * a coach half a second and no reading.
 *
 * Coordinates are StatsBomb's 120x80 pitch, in yards, attacking left to right.
 */

/**
 * The pitch is drawn at ten units per yard.
 *
 * `hand-drawn.ts` hardcodes its wobble in absolute units — 2.2 for a line, 1 for
 * an arrow head — calibrated for the ~1000-unit viewBoxes used elsewhere on the
 * site. Drawn at 1 unit per yard, that same wobble is 2% of the pitch and turns
 * every arrow head into a starburst. Scaling the canvas rather than the library
 * keeps the chalk consistent everywhere.
 */
const S = 10;
const L = 120 * S;
const W = 80 * S;
const EASE = [0.4, 0, 0.2, 1] as const;

function PitchMarkings() {
  return (
    <g stroke="rgba(255,255,255,0.11)" strokeWidth={3} fill="none">
      <rect x={5} y={5} width={L - 10} height={W - 10} />
      <line x1={L / 2} y1={5} x2={L / 2} y2={W - 5} />
      <circle cx={L / 2} cy={W / 2} r={10 * S} />
      <rect x={5} y={18 * S} width={18 * S} height={44 * S} />
      <rect x={L - 18 * S - 5} y={18 * S} width={18 * S} height={44 * S} />
      <rect x={5} y={30 * S} width={6 * S} height={20 * S} />
      <rect x={L - 6 * S - 5} y={30 * S} width={6 * S} height={20 * S} />
    </g>
  );
}

export function MomentPitch({ moment }: { moment: Moment | null }) {
  const rand = useMemo(() => seededRandom((moment?.id ?? 0) + 11), [moment?.id]);

  if (!moment) {
    return (
      <div className="flex aspect-[120/80] w-full items-center justify-center border border-rule bg-pitch">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
          pick a moment
        </span>
      </div>
    );
  }

  const [fx, fy] = moment.from.map((v) => v * S);
  const [px, py] = moment.played_to.map((v) => v * S);
  const [bx, by] = moment.best_to.map((v) => v * S);

  return (
    <div className="relative w-full border border-rule bg-pitch">
      <svg viewBox={`0 0 ${L} ${W}`} className="block h-full w-full">
        <PitchMarkings />

        {/* No chalk-texture filter here: its displacement is calibrated for the
            1000px viewBoxes used elsewhere, and on a 120-unit pitch it turns a
            pass into a scribble. The hand-drawn jitter alone carries the look. */}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* What was played. Dim, because it is the thing being compared
              against rather than the thing being recommended. */}
          <motion.path
            key={`played-${moment.id}`}
            d={handArrow(fx, fy, px, py, rand, 22)}
            stroke="var(--color-muted)"
            strokeWidth={5}
            opacity={0.75}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.45, ease: EASE }}
          />

          {/* What was on. */}
          <motion.path
            key={`best-${moment.id}`}
            d={handArrow(fx, fy, bx, by, rand, 26)}
            stroke="var(--color-accent)"
            strokeWidth={8}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.55, ease: EASE, delay: 0.25 }}
          />

          <motion.path
            d={handArc(bx, by, 30, 0, Math.PI * 2, rand)}
            stroke="var(--color-accent)"
            strokeWidth={6}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.7 }}
          />

          {/* The passer. */}
          <path
            d={handLine(fx - 14, fy, fx + 14, fy, rand, 1)}
            stroke="var(--color-chalk)"
            strokeWidth={6}
          />
          <path
            d={handLine(fx, fy - 14, fx, fy + 14, rand, 1)}
            stroke="var(--color-chalk)"
            strokeWidth={6}
          />
        </g>
      </svg>

      {/* Legend, in the corner, small. It should be readable but never compete
          with the two arrows it is describing. */}
      <div className="absolute bottom-2 left-2 flex flex-col gap-1 bg-black/55 px-2 py-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
          <span className="h-px w-4 bg-muted" /> played
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-accent">
          <span className="h-px w-4 bg-accent" /> was on
        </span>
      </div>

      <div className="absolute top-2 right-2 bg-black/55 px-2 py-1">
        <span className="font-mono text-[10px] tabular-nums text-chalk">
          {moment.minute}&rsquo; {surname(moment.player)}
        </span>
      </div>
    </div>
  );
}
