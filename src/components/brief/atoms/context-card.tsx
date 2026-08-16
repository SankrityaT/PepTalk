"use client";

import { motion } from "motion/react";

/**
 * What the agent pulled in, shown as it pulled it.
 *
 * Retrieval is the part of an agent product that users never see and always
 * suspect. Showing the chunks — with the file they came from and how big they
 * were — converts "trust me" into "here is what I read".
 *
 * Each card names a real source. If a card cannot name one, it should not be
 * on the page.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

export type Chunk = {
  title: string;
  size: string;
  body: string;
  source: string;
  badge: string;
  /** Tailwind text colour for the badge, matched to the source type. */
  tone?: string;
};

export function ContextCards({
  chunks,
  label = "Pulled in",
}: {
  chunks: Chunk[];
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-2">
        {label}
      </span>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {chunks.map((c, i) => (
          <motion.div
            key={c.title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.08, ease: EASE }}
            className="rounded-xl bg-surface p-3.5 ring-1 ring-white/[0.06]"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] font-medium text-chalk">
                {c.title}
              </span>
              <span
                className={`shrink-0 rounded border border-current/25 px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.1em] ${
                  c.tone ?? "text-muted"
                }`}
              >
                {c.badge}
              </span>
            </div>

            <p className="mt-2 text-[12px] leading-relaxed text-warm-2">
              {c.body}
            </p>

            <div className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-white/[0.05] pt-2">
              <span className="truncate font-mono text-[10px] text-muted-2">
                {c.source}
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-2">
                {c.size}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
