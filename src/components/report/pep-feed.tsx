"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGame } from "@/content/game";
import { Moment, surname } from "@/content/pep";

/**
 * Pep's read, as a feed.
 *
 * One entry per moment: the line in plain English, the maths folded away behind
 * a disclosure. A coach reads the line and never opens the numbers; a judge
 * opens the numbers first. Both are served without either being talked down to.
 *
 * Selecting an entry is the product's one killer interaction — it draws the
 * ball that was played against the ball that was on, on the pitch beside it.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

function DifficultyTag({ m }: { m: Moment }) {
  // The strongest case is not "worth more" — it is "worth more and no harder".
  if (m.no_riskier) {
    return (
      <span className="border border-accent/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-accent">
        no riskier
      </span>
    );
  }
  const tone =
    m.difficulty === "hard" ? "text-muted-2 border-rule" : "text-muted border-rule";
  return (
    <span className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${tone}`}>
      {m.difficulty}
    </span>
  );
}

export function PepFeed({
  selected,
  onSelect,
}: {
  selected: number | null;
  onSelect: (m: Moment) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  // Whichever game is showing. Outside a provider this is the committed
  // example, which is what the landing page and a fresh clone render.
  const { moments: MOMENTS, momentsFound: MOMENTS_FOUND } = useGame();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="h-1.5 w-1.5 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
            Pep
          </span>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-muted-2">
          {MOMENTS.length} of {MOMENTS_FOUND.toLocaleString()}
        </span>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {MOMENTS.map((m) => {
          const on = selected === m.id;
          const showing = open === m.id;
          return (
            <li key={m.id} className="border-b border-white/[0.05] last:border-b-0">
              <button
                onClick={() => onSelect(m)}
                className={`w-full px-5 py-4 text-left transition-colors duration-150 ease-[var(--ease-ui)] ${
                  on ? "bg-accent/[0.12]" : "hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex items-baseline gap-2.5">
                  <span
                    className={`font-mono text-[11px] tabular-nums ${on ? "text-accent" : "text-muted"}`}
                  >
                    {m.minute}&rsquo;
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-chalk-2">
                    {surname(m.player)}
                  </span>
                  <span className="ml-auto shrink-0">
                    <DifficultyTag m={m} />
                  </span>
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-warm-2">
                  {m.line}
                </p>
              </button>

              <div className="px-5 pb-3">
                <button
                  onClick={() => setOpen(showing ? null : m.id)}
                  className="font-mono text-[10px] text-muted-2 transition-colors hover:text-muted"
                  aria-expanded={showing}
                >
                  {showing ? "▴" : "▾"} the numbers
                </button>
                <AnimatePresence initial={false}>
                  {showing && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <p className="pt-2 font-mono text-[10px] leading-relaxed text-muted">
                        {m.numbers}
                      </p>
                      <p className="pt-1 font-mono text-[10px] leading-relaxed text-muted-2">
                        played {m.played_zone} · available {m.best_zone}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
