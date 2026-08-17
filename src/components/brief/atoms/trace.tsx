"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader } from "@/components/brief/atoms/loader";

/**
 * The agent's own work, shown.
 *
 * Steps run one at a time, then settle into muted checks and stay expandable.
 * A coach collapses it and never opens it again; a judge opens it first. Both
 * are served without either being talked down to.
 *
 * **The rule that makes this worth having: every row corresponds to something
 * that actually ran.** A trace that lists work not done is worse than no trace
 * at all — it is the exact move that makes people distrust agent products, and
 * it is invisible until someone checks, at which point nothing else on the
 * page survives either. So the rows here carry the real per-stage figures from
 * the pipeline, and the footer says the run is a replay.
 */

export type Step = {
  label: string;
  /** The real number this stage produced. Filled in once the stage lands. */
  detail: string;
};

const EASE = [0.4, 0, 0.2, 1] as const;
const STEP_MS = 520;

export function Trace({
  steps,
  title = "Reading your games",
  doneTitle = "Read your games",
  footer,
  onDone,
  live,
  collapseWhenDone = true,
}: {
  steps: Step[];
  title?: string;
  doneTitle?: string;
  footer?: string;
  onDone?: () => void;
  /**
   * Drive the trace off real work instead of a timer.
   *
   * The replay of a finished pipeline can step on a clock, because the stages
   * already happened and their figures are known. A question being answered
   * right now cannot: the last stage has to keep spinning until the model
   * actually replies, however long that takes. Pass `false` while the request
   * is in flight and `true` when it lands.
   */
  live?: boolean;
  collapseWhenDone?: boolean;
}) {
  const [stage, setStage] = useState(0);
  const [open, setOpen] = useState(true);

  // In live mode the trace walks up to the last stage on its own and waits
  // there. Claiming a stage finished before its work has is the one thing a
  // trace must never do, so the ceiling stops one short until the caller says.
  const ceiling = live === undefined || live ? steps.length : steps.length - 1;
  const running = stage < steps.length;

  useEffect(() => {
    if (stage >= ceiling) {
      if (stage < steps.length) return;
      if (!collapseWhenDone) {
        onDone?.();
        return;
      }
      const t = setTimeout(() => {
        setOpen(false);
        onDone?.();
      }, 500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStage((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, ceiling, steps.length, collapseWhenDone]);

  return (
    <div className="rounded-xl bg-surface ring-1 ring-white/[0.06]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        {running ? (
          <Loader label={title} />
        ) : (
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-accent">✓</span>
            <span className="text-[13px] font-medium text-warm-2">
              {doneTitle}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-2">
              {steps.length} steps
            </span>
          </span>
        )}
        <span className="font-mono text-[10px] text-muted-2">
          {open ? "▴" : "▾"}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: EASE }}
            className="overflow-hidden"
          >
            <ul className="border-t border-white/[0.05] px-4 py-2.5">
              {steps.map((s, i) => {
                const done = i < stage;
                const active = i === stage;
                return (
                  <motion.li
                    key={s.label}
                    animate={{ opacity: done || active ? 1 : 0.28 }}
                    transition={{ duration: 0.25 }}
                    className="flex items-baseline justify-between gap-4 py-1.5"
                  >
                    <span className="flex items-baseline gap-2.5">
                      <span
                        className={`font-mono text-[11px] ${
                          done ? "text-accent" : "text-muted-2"
                        }`}
                      >
                        {done ? "✓" : active ? "·" : " "}
                      </span>
                      <span
                        className={`text-[13px] ${
                          done || active ? "text-warm-2" : "text-muted-2"
                        }`}
                      >
                        {s.label}
                      </span>
                    </span>
                    <motion.span
                      animate={{ opacity: done ? 1 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="shrink-0 font-mono text-[11px] tabular-nums text-muted"
                    >
                      {s.detail}
                    </motion.span>
                  </motion.li>
                );
              })}
            </ul>
            {footer && (
              <p className="border-t border-white/[0.05] px-4 py-2.5 font-mono text-[10px] leading-relaxed text-muted-2">
                {footer}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
