"use client";

import { motion } from "motion/react";
import { MOMENTS, Moment, THEMES, surname } from "@/content/pep";

/**
 * This week. The top of the report, and the reason it exists.
 *
 * A coach's question is not "what happened" — they were there. It is "what do I
 * do at training on Tuesday". So the report opens with three things to work on
 * and puts the evidence underneath, rather than making someone read eight
 * observations and synthesise the answer themselves.
 *
 * Three because a coach can hold three. A list of eight is a list of nothing.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

export function ThisWeek({ onSelect }: { onSelect: (m: Moment) => void }) {
  if (!THEMES.length) return null;

  return (
    <section>
      <h2 className="text-[15px] font-medium text-warm-2">
        Three things for Tuesday
      </h2>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {THEMES.map((t, i) => {
          const clips = t.moment_ids
            .map((id) => MOMENTS.find((m) => m.id === id))
            .filter(Boolean) as Moment[];

          return (
            <motion.article
              key={t.title}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.09, ease: EASE }}
              className="flex flex-col rounded-lg bg-surface p-6 ring-1 ring-white/[0.06] transition-colors duration-200 ease-[var(--ease-ui)] hover:bg-surface-2"
            >
              <span className="font-mono text-[11px] tabular-nums text-accent">
                {String(i + 1).padStart(2, "0")}
              </span>

              <h3 className="mt-3 text-[19px] leading-snug font-medium text-chalk">
                {t.title}
              </h3>

              <p className="mt-3 flex-1 text-[14px] leading-relaxed text-warm-2">
                {t.why}
              </p>

              {clips.length > 0 && (
                <div className="mt-5 border-t border-white/[0.07] pt-4">
                  <span className="text-[12px] text-muted-2">
                    {clips.length} {clips.length === 1 ? "clip" : "clips"}
                  </span>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {clips.slice(0, 4).map((c) => (
                      <button
                        key={c.id}
                        onClick={() => onSelect(c)}
                        className="rounded bg-white/[0.05] px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-warm transition-colors hover:bg-accent/20 hover:text-chalk"
                        title={`${surname(c.player)} — ${c.line}`}
                      >
                        {c.minute}&rsquo;
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}
