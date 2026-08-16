"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Choice } from "@/components/brief/atoms/choice";
import { StreamText } from "@/components/brief/atoms/stream-text";
import { Turn } from "@/components/brief/atoms/turn";
import { MomentFrame } from "@/components/report/moment-frame";
import { CLIP_FROM, CLIP_MOMENTS, CLIP_TO } from "@/content/clip";
import { MOMENTS, Moment, surname } from "@/content/pep";

/**
 * Going through the moments: evidence pinned on one side, coaching on the
 * other.
 *
 * The layout matters. Stacking them meant reaching the talk scrolled the
 * picture off screen and took the controls with it, so the panel is pinned and
 * the thread grows beside it, which is how anyone reviews footage.
 *
 * **What is shown, and why it is not the video.** An earlier build ran the
 * clip and stopped it on seven passes that fell inside its ninety seconds. The
 * football was wrong: those passes have a threat gap of 0.001 to 0.033, which
 * is a fraction of a percent of a goal. Calling a sideways ball in midfield a
 * mistake at that magnitude is noise dressed as insight, and it misreads the
 * game besides, since circulating the ball is how a side moves an opponent and
 * makes space.
 *
 * With a materiality bar applied, the match yields eight moments rather than
 * 803, and none of them fall in the passage we hold footage for. So the panel
 * shows the freeze frame, which is real evidence for the claim being made, and
 * says plainly that the video for those minutes is not loaded. Inventing an
 * alignment would be worse than admitting one is missing.
 */

function Tag({ m }: { m: Moment }) {
  const cls = m.no_riskier
    ? "border-accent/40 text-accent"
    : "border-white/15 text-muted";
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] uppercase ${cls}`}>
      {m.no_riskier ? "no riskier" : m.difficulty}
    </span>
  );
}

export function Walkthrough({ onDone }: { onDone?: (seen: number) => void }) {
  const moments = MOMENTS;
  const tail = useRef<HTMLDivElement>(null);

  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);

  const current = moments[index];
  const atEnd = index >= moments.length - 1;
  const seen = moments.slice(0, index + 1);

  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [index, finished]);

  if (!current) return null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
      {/* ── The moment, pinned ─────────────────────────────────────────── */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] px-4 py-2.5">
            <span className="flex items-baseline gap-2.5">
              <span className="font-mono text-[12px] tabular-nums text-accent">
                {current.minute}&rsquo;
              </span>
              <span className="text-[14px] font-medium text-chalk">
                {surname(current.player)}
              </span>
              <Tag m={current} />
            </span>
            <span className="font-mono text-[10px] tracking-[0.1em] text-muted-2 uppercase">
              {index + 1} of {moments.length}
            </span>
          </div>

          <div className="p-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={current.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <MomentFrame moment={current} />
              </motion.div>
            </AnimatePresence>

            <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-2">
              {current.freeze?.length ?? 0} players, exactly where they stood
              when the ball was struck
            </p>
          </div>

          {/* ── Controls, always on screen ──────────────────────────── */}
          <div className="flex items-center gap-2 border-t border-white/[0.05] px-3.5 py-3">
            <button
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              aria-label="Previous moment"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-warm transition-colors enabled:hover:bg-white/[0.13] enabled:hover:text-chalk disabled:opacity-30"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>

            <div className="flex flex-1 items-center gap-1.5">
              {moments.map((m, i) => (
                <button
                  key={m.id}
                  onClick={() => setIndex(i)}
                  title={`${m.minute}' ${surname(m.player)}`}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i === index
                      ? "bg-accent"
                      : i < index
                        ? "bg-white/40"
                        : "bg-white/15 hover:bg-white/30"
                  }`}
                />
              ))}
            </div>

            <button
              onClick={() => setIndex((i) => Math.min(moments.length - 1, i + 1))}
              disabled={atEnd}
              aria-label="Next moment"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-warm transition-colors enabled:hover:bg-white/[0.13] enabled:hover:text-chalk disabled:opacity-30"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Said plainly rather than discovered by a coach who goes looking. */}
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-2">
          Footage for these minutes is not loaded. The clip we hold runs{" "}
          {CLIP_FROM} to {CLIP_TO}, and there is nothing in it worth stopping
          for.
        </p>
      </div>

      {/* ── The coaching ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3.5">
        {seen.map((m, i) => (
          <Turn key={m.id} showWho={i === 0}>
            <div
              className={`rounded-xl p-3.5 ring-1 transition-colors ${
                i === index
                  ? "bg-surface-2 ring-accent/25"
                  : "bg-surface ring-white/[0.06]"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] tabular-nums text-accent">
                    {m.minute}&rsquo;
                  </span>
                  <span className="text-[13px] font-medium text-chalk">
                    {surname(m.player)}
                  </span>
                </span>
                <button
                  onClick={() => setIndex(i)}
                  className="font-mono text-[10px] text-muted-2 transition-colors hover:text-accent"
                >
                  {i === index ? "on screen" : "show me"}
                </button>
              </div>

              <p className="mt-2 text-[14px] leading-relaxed text-warm">
                {i === index ? <StreamText text={m.line} /> : m.line}
              </p>

              <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-muted">
                {m.numbers}
              </p>
            </div>
          </Turn>
        ))}

        <AnimatePresence mode="wait">
          {!finished && !atEnd && (
            <Turn key={`ask-${index}`} showWho={false}>
              <Choice
                question={
                  index === 0
                    ? "That is the first one. Want the next?"
                    : `${moments.length - index - 1} left. Keep going?`
                }
                onPick={(k) => {
                  if (k === "next") setIndex((i) => i + 1);
                  else {
                    setFinished(true);
                    onDone?.(index + 1);
                  }
                }}
                options={[
                  { key: "next", label: "Next one", primary: true },
                  { key: "stop", label: "That is enough" },
                ]}
              />
            </Turn>
          )}

          {!finished && atEnd && (
            <Turn key="end" showWho={false}>
              <p className="text-[14px] leading-relaxed text-warm-2">
                <StreamText
                  text={`That is all ${moments.length}. Every one of them was a ball into the box that would have created a chance, not a tidier pass in midfield.`}
                  onDone={() => onDone?.(moments.length)}
                />
              </p>
            </Turn>
          )}

          {finished && (
            <Turn key="stopped" showWho={false}>
              <p className="text-[14px] leading-relaxed text-muted">
                Stopped there. The rest are waiting whenever you want them.
              </p>
            </Turn>
          )}
        </AnimatePresence>

        <div ref={tail} />
      </div>
    </div>
  );
}

/** Nothing in the passage we hold footage for cleared the bar. */
export const CLIP_HAS_NOTHING = CLIP_MOMENTS.length === 0;
