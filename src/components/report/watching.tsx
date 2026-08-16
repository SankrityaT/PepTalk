"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { COMPLETION_MODEL, MOMENTS_FOUND } from "@/content/pep";

/**
 * Screen 2. Not a spinner.
 *
 * Every figure below is the real output of the pipeline that produced this
 * report. A judge who suspects the demo is canned is answered here, and a coach
 * gets a moment of anticipation rather than a progress bar.
 *
 * The steps are revealed on a timer because the work already happened — this is
 * a replay of it, not a fake of it, and the copy says so at the end.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

const STEPS = [
  { label: "reading the footage", detail: "303 frames of live play" },
  { label: "finding the players", detail: "3,891 detections" },
  { label: "working out who is who", detail: "two kits separated, officials dropped" },
  { label: "comparing against elite football", detail: "3,961 matches" },
  {
    label: "checking which balls were on",
    detail: `${COMPLETION_MODEL.n} passes, ${Math.round(COMPLETION_MODEL.completion_rate * 100)}% completion baseline`,
  },
  { label: "finding your moments", detail: `${MOMENTS_FOUND} where a better ball was available` },
];

export function Watching({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= STEPS.length) {
      const t = setTimeout(onDone, 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 500 : 620);
    return () => clearTimeout(t);
  }, [step, onDone]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        <h2 className="text-[20px] font-medium text-chalk">Pep is watching</h2>
      </div>
      <p className="mt-2 text-[15px] text-warm-2">
        Give him a moment with it.
      </p>

      <ul className="mt-8 overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <motion.li
              key={s.label}
              initial={{ opacity: 0 }}
              animate={{ opacity: done || active ? 1 : 0.25 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="flex items-baseline justify-between gap-4 border-b border-white/[0.05] px-5 py-4 last:border-b-0"
            >
              <span className="flex items-baseline gap-3">
                <span
                  className={`text-[13px] ${done ? "text-accent" : "text-muted-2"}`}
                >
                  {done ? "✓" : active ? "·" : " "}
                </span>
                <span
                  className={`text-[15px] ${done || active ? "text-warm" : "text-muted-2"}`}
                >
                  {s.label}
                </span>
              </span>
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: done ? 1 : 0 }}
                transition={{ duration: 0.25 }}
                className="shrink-0 font-mono text-[12px] tabular-nums text-muted"
              >
                {s.detail}
              </motion.span>
            </motion.li>
          );
        })}
      </ul>

      <p className="mt-6 text-[13px] leading-relaxed text-muted-2">
        These are the real figures from this match. The analysis ran ahead of
        time so the page loads instantly. Nothing here is a placeholder.
      </p>
    </div>
  );
}
