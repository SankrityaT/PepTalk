"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * The intake.
 *
 * A coach does not "use" this — that is the point. Video arrives from whatever
 * they already record with, and by the time they open the dashboard the work is
 * done. Showing the queue is how the product says *I have been working while
 * you were at your day job*, which is the entire promise.
 *
 * Honesty note, because this panel is the easiest place on the page to cheat:
 * the *stages* are the real pipeline in the real order, and the 124ms graph
 * write is measured. The *fixtures* are invented — a club that does not exist,
 * playing games that did not happen — because a single coach's intake queue is
 * not something we have. The panel is labelled as a sample so that nothing here
 * reads as computed output, and no figure in it is presented as a model result.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

const STAGES = ["tracking players", "reading the passes", "writing to the graph"] as const;

type Item = {
  id: number;
  name: string;
  from: string;
  /** Index into STAGES, or -1 once done. */
  stage: number;
  progress: number;
};

/** The queue cycles through these so the strip is never dead on arrival. */
const ARRIVALS = [
  { name: "u16s_vs_ashford_2h.mp4", from: "touchline camera", rate: 1 },
  { name: "firsts_vs_marlow.mov", from: "phone upload", rate: 0.62 },
  { name: "reserves_vs_didcot.mp4", from: "touchline camera", rate: 0.78 },
  { name: "u16s_vs_thame_1h.mp4", from: "phone upload", rate: 0.55 },
] as const;

const DONE_TODAY = 3;

/** Sample fixtures already through the queue. */
const SETTLED = [
  { name: "u16s_vs_henley_2h.mp4", len: "44:10" },
  { name: "firsts_vs_wallingford.mp4", len: "91:26" },
  { name: "u16s_vs_henley_1h.mp4", len: "45:02" },
] as const;

/** How fast the replayed run advances, in progress-percent per tick. */
const TICK_MS = 110;
const STEP = 0.75;

function make(id: number): Item {
  const a = ARRIVALS[id % ARRIVALS.length];
  return { id, name: a.name, from: a.from, stage: 0, progress: 0 };
}

export function Pipeline() {
  const [items, setItems] = useState<Item[]>(() => [make(0), make(1)]);
  const [finished, setFinished] = useState(DONE_TODAY);

  // The queue is advanced in a ref rather than through a state updater.
  // React double-invokes updaters in development, so counting completions
  // inside one counted every finished clip twice.
  const queue = useRef<Item[]>([make(0), make(1)]);
  const nextId = useRef(2);
  const done = useRef(DONE_TODAY);

  useEffect(() => {
    const t = setInterval(() => {
      const next: Item[] = [];
      for (const it of queue.current) {
        const rate = ARRIVALS[it.id % ARRIVALS.length].rate;
        const p = it.progress + STEP * rate;
        if (p < 100) {
          next.push({ ...it, progress: p, stage: Math.floor((p / 100) * STAGES.length) });
        } else {
          done.current += 1;
        }
      }
      // Keep two in flight. Footage does not stop arriving because you
      // happen to be looking at the dashboard.
      while (next.length < 2) next.push(make(nextId.current++));

      queue.current = next;
      setItems(next);
      setFinished(done.current);
    }, TICK_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-full flex-col rounded-xl bg-surface p-5 ring-1 ring-white/[0.06]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-medium text-chalk">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          Coming in
          <span className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-2">
            sample
          </span>
        </h2>
        <span className="font-mono text-[10px] tabular-nums text-muted-2">
          {finished} done today
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        Footage lands here on its own. You don&rsquo;t press anything.
      </p>

      <ul className="mt-4 flex flex-col gap-2.5">
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <motion.li
              key={it.id}
              layout
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="overflow-hidden rounded-lg bg-surface-2 px-3.5 py-3 ring-1 ring-white/[0.05]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-[11px] text-warm">
                  {it.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-2">
                  {Math.min(99, Math.floor(it.progress))}%
                </span>
              </div>
              <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
                <motion.div
                  className="h-full rounded-full bg-accent"
                  animate={{ width: `${it.progress}%` }}
                  transition={{ duration: TICK_MS / 1000, ease: "linear" }}
                />
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <span className="font-mono text-[10px] text-accent">
                  {STAGES[Math.min(it.stage, STAGES.length - 1)]}
                </span>
                <span className="font-mono text-[10px] text-muted-2">{it.from}</span>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {/* What came through earlier, so the panel reads as a stream rather than
          a two-row widget with a hole under it. */}
      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
          through this morning
        </span>
        <ul className="mt-3 flex flex-col gap-2.5">
          {SETTLED.map((s) => (
            <li key={s.name} className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-[10px] text-accent">✓</span>
                <span className="truncate font-mono text-[11px] text-warm-2">
                  {s.name}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-2">
                {s.len}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-auto pt-4 font-mono text-[10px] leading-relaxed text-muted-2">
        example fixtures &middot; real stages &middot; graph write 124ms
      </p>
    </div>
  );
}
