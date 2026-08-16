"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { XT, XT_ACTIONS, XT_MAX, XT_TRAINED_ON } from "@/content/dashboard";

/**
 * The expected-threat model, drawn.
 *
 * This is not an illustration of the model — it *is* the model. Each cell is
 * one value from the 16x12 grid the pass engine indexes into: the probability
 * this team scores within the next few actions, given the ball is here.
 *
 * It earns the top of the dashboard because it explains the entire product in
 * one glance. Everything Pep says downstream — "that ball was worth five times
 * what you played" — is a subtraction between two cells of this picture.
 *
 * The ramp is raised to a fractional power because the values are violently
 * skewed: the mean own-third cell is 0.002 and the hottest is 0.278. Linear
 * shading would render five-sixths of the pitch as flat black and throw away
 * the gradient that makes it legible.
 *
 * But only slightly fractional. An aggressive exponent lights the whole pitch
 * and tells the coach the exact opposite of what the model says — the truth
 * here is that most of a football pitch is worth almost nothing, and the
 * picture has to keep saying that.
 */

const RAMP_GAMMA = 0.8;

/** Cells this cold are not worth drawing; they'd read as noise. */
const FLOOR = 0.02;

function heat(v: number): string {
  const t = Math.pow(v / XT_MAX, RAMP_GAMMA);
  if (t < FLOOR) return "transparent";
  // One hue, climbing in lightness and opacity, so the pitch stays inside the
  // single-accent rule while still reading as a heat map.
  const light = 46 + t * 26;
  return `hsl(18 ${88 - t * 14}% ${light}% / ${0.09 + t * 0.91})`;
}

const COLS = XT.length;
const ROWS = XT[0].length;
const W = 120;
const H = 80;
const CW = W / COLS;
const CH = H / ROWS;

const EASE = [0.4, 0, 0.2, 1] as const;

export function XtPitch() {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const value = hover ? XT[hover.x][hover.y] : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-medium text-chalk">
          What the ball is worth, everywhere on the pitch
        </h2>
        <span className="font-mono text-[10px] tabular-nums text-muted-2">
          {XT_TRAINED_ON.toLocaleString()} matches &middot;{" "}
          {(XT_ACTIONS / 1e6).toFixed(1)}M actions
        </span>
      </div>
      <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted">
        Learned from elite football, then used to judge yours. Hover anywhere.
      </p>

      <div className="relative mt-4">
        <svg
          viewBox={`-2 -2 ${W + 4} ${H + 4}`}
          className="w-full rounded-md bg-[#070707] ring-1 ring-white/[0.06]"
          onMouseLeave={() => setHover(null)}
        >
          {XT.map((col, x) =>
            col.map((v, y) => (
              <motion.rect
                key={`${x}-${y}`}
                x={x * CW}
                y={y * CH}
                width={CW}
                height={CH}
                fill={heat(v)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{
                  duration: 0.4,
                  delay: 0.1 + x * 0.022,
                  ease: EASE,
                }}
                onMouseEnter={() => setHover({ x, y })}
                stroke={
                  hover?.x === x && hover?.y === y ? "#ffffff" : "transparent"
                }
                strokeWidth={0.6}
              />
            )),
          )}

          {/* Pitch markings, over the heat. */}
          <g
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={0.4}
            pointerEvents="none"
          >
            <rect x={0} y={0} width={W} height={H} />
            <line x1={W / 2} y1={0} x2={W / 2} y2={H} />
            <circle cx={W / 2} cy={H / 2} r={10} />
            <rect x={0} y={18} width={18} height={44} />
            <rect x={W - 18} y={18} width={18} height={44} />
            <rect x={0} y={30} width={6} height={20} />
            <rect x={W - 6} y={30} width={6} height={20} />
          </g>

          {/* Direction of play — a coach needs to know which way is forward. */}
          <g pointerEvents="none">
            <line
              x1={W / 2 - 9}
              y1={H + 0.2}
              x2={W / 2 + 9}
              y2={H + 0.2}
              stroke="rgba(255,255,255,0.28)"
              strokeWidth={0.4}
            />
            <path
              d={`M ${W / 2 + 9} ${H + 0.2} l -2.6 -1.5 v 3 z`}
              fill="rgba(255,255,255,0.28)"
            />
          </g>
        </svg>

        {/* Readout. Reserves its line so the layout never jumps on hover. */}
        <div className="mt-3 flex h-5 items-center justify-between gap-4">
          {value !== null ? (
            <span className="font-mono text-[11px] tabular-nums text-chalk">
              {(value * 100).toFixed(2)}%
              <span className="ml-2 text-muted-2">
                chance of scoring from here
              </span>
            </span>
          ) : (
            <span className="text-[12px] text-muted-2">
              Dark is safe, bright is dangerous.
            </span>
          )}

          <span className="flex shrink-0 items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted-2">0</span>
            <span
              className="h-1.5 w-24 rounded-full"
              style={{
                background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1]
                  .map((t) => heat(t * XT_MAX))
                  .join(", ")})`,
              }}
            />
            <span className="font-mono text-[10px] tabular-nums text-muted-2">
              {(XT_MAX * 100).toFixed(0)}%
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
