"use client";

import { motion } from "motion/react";
import {
  bandPhrase,
  DIMENSION_LABEL,
  DIMENSION_UNIT,
  ISTANBUL,
  OPPONENT_MEMORY,
  SIGNIFICANT_DEVIATIONS,
} from "@/content/istanbul";

/**
 * The halftime screen.
 *
 * What a Liverpool coach would actually be handed at the break in Istanbul,
 * rather than four paragraphs explaining that such a thing could exist.
 * Two columns because that is the only question worth answering at 3-0
 * down: who are they, and what have we been doing.
 *
 * Every value is from the graph. The opponent column is Milan's stored
 * profile; the right column is Liverpool's first half measured against
 * their own norm.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

function CornerTicks() {
  const tick = "absolute h-3 w-3 border-accent";
  return (
    <>
      <span className={`${tick} -top-px -left-px border-t border-l`} />
      <span className={`${tick} -top-px -right-px border-t border-r`} />
      <span className={`${tick} -bottom-px -left-px border-b border-l`} />
      <span className={`${tick} -bottom-px -right-px border-b border-r`} />
    </>
  );
}

export function HalftimeScreen() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ duration: 0.6, ease: EASE }}
      className="relative border border-rule bg-white/[0.02]"
    >
      <CornerTicks />

      {/* ── Bar ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-4 sm:px-7">
        <div className="flex items-center gap-2.5">
          <span className="h-1.5 w-1.5 animate-pulse bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
            Halftime
          </span>
        </div>
        <span className="font-mono text-[11px] tracking-[0.1em] text-chalk sm:text-[13px]">
          AC MILAN 3 &nbsp;&ndash;&nbsp; 0 LIVERPOOL
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2">
        {/* ── Who they are ────────────────────────────────────────── */}
        <div className="border-b border-rule px-5 py-6 sm:px-7 md:border-r md:border-b-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              Your opponent
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-2">
              {OPPONENT_MEMORY.total_evidence} obs
            </span>
          </div>

          <ul className="mt-5 flex flex-col gap-3.5">
            {OPPONENT_MEMORY.facts.map((f) => (
              <li key={f.fact_id} className="flex items-baseline justify-between gap-4">
                <span className="text-[14px] text-chalk-2">
                  {bandPhrase(f.dimension, f.band)}
                </span>
                <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">
                  {f.median_value}
                  {DIMENSION_UNIT[f.dimension] ?? ""}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* ── What you have been doing ────────────────────────────── */}
        <div className="px-5 py-6 sm:px-7">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              You, this half
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
              vs your norm
            </span>
          </div>

          <ul className="mt-5 flex flex-col gap-3.5">
            {SIGNIFICANT_DEVIATIONS.map((d) => {
              const unit = DIMENSION_UNIT[d.dimension] ?? "";
              return (
                <li key={d.dimension} className="flex items-baseline justify-between gap-4">
                  <span className="text-[14px] text-chalk-2">
                    {DIMENSION_LABEL[d.dimension]}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-3 font-mono text-[12px] tabular-nums">
                    <span className="text-chalk">
                      {d.match_value}
                      {unit}
                    </span>
                    <span className="w-16 text-right text-accent">
                      {d.delta > 0 ? "+" : ""}
                      {d.delta.toFixed(1)}
                      {unit}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* ── The read ──────────────────────────────────────────────── */}
      <div className="border-t border-rule bg-accent/[0.05] px-5 py-6 sm:px-7">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
          The read
        </span>
        <p className="mt-3 max-w-2xl font-display text-[1.05rem] leading-[1.35] tracking-[-0.01em] text-chalk sm:text-[1.3rem]">
          You are already pressing lower and sitting deeper than you normally
          do. That is not what is losing you the game.
        </p>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
          Derived from {SIGNIFICANT_DEVIATIONS.length} deviations against{" "}
          {SIGNIFICANT_DEVIATIONS[0]?.era_matches} prior matches ·{" "}
          {ISTANBUL.date}
        </p>
      </div>
    </motion.div>
  );
}
