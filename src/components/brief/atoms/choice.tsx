"use client";

import { motion } from "motion/react";

/**
 * The beat where the brief stops and hands control back.
 *
 * The whole design rests on this: Pep does the work unasked, then asks *one*
 * question with the obvious answer first. A coach who wants the full run-through
 * presses one key; a coach in a hurry takes the short version; a coach who
 * came for something else ignores it and types.
 *
 * Deliberately not a modal. Nothing here should block the page — the brief
 * above it stays readable and the prompt bar stays live.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

export type Option = {
  key: string;
  label: string;
  /** Set on the one that should be pressed by default. */
  primary?: boolean;
};

export function Choice({
  question,
  options,
  onPick,
  picked,
}: {
  question: string;
  options: Option[];
  onPick: (key: string) => void;
  picked?: string | null;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="rounded-xl bg-surface-2 p-4 ring-1 ring-white/[0.08]"
    >
      <p className="text-[15px] leading-snug text-chalk">{question}</p>

      <div className="mt-3.5 flex flex-wrap gap-2">
        {options.map((o) => {
          const on = picked === o.key;
          return (
            <button
              key={o.key}
              onClick={() => onPick(o.key)}
              disabled={!!picked}
              className={`rounded-full px-4 py-2 text-[13px] transition-all duration-150 ease-[var(--ease-ui)] disabled:cursor-default ${
                on
                  ? "bg-accent text-canvas"
                  : o.primary && !picked
                    ? "bg-accent text-canvas hover:brightness-110"
                    : picked
                      ? "bg-white/[0.04] text-muted-2"
                      : "bg-white/[0.06] text-warm hover:bg-white/[0.11] hover:text-chalk"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
