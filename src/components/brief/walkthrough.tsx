"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Choice } from "@/components/brief/atoms/choice";
import { StreamText } from "@/components/brief/atoms/stream-text";
import { Turn } from "@/components/brief/atoms/turn";
import { ChalkFilters } from "@/components/chalk-filters";
import { ChalkOverlay } from "@/components/brief/chalk-overlay";
import { MomentFrame } from "@/components/report/moment-frame";
import {
  CLIP_MOMENTS,
  ClipMoment,
  KIT,
  clockAt,
  frameAt,
} from "@/content/clip";

/**
 * Going through the moments: the footage on one side, the coaching on the
 * other.
 *
 * The tape is pinned. Stacking them meant reaching the talk scrolled the
 * picture off screen and took the controls with it, which is the opposite of
 * how anyone reviews footage.
 *
 * Every clip is the real seconds of the real match. Each was cut from a full
 * recording using an offset read off the broadcast clock, then verified by
 * reading that clock back off the first frame. The pass lands six seconds in,
 * so the passage plays before Pep stops it, which is where a coach would hit
 * the spacebar anyway.
 *
 * The moments themselves are the eight that clear a materiality bar, not the
 * 803 passes with any better option at all. Circulating the ball is how a side
 * moves a defence; only a ball that would have made a chance is worth stopping
 * for.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

function Tag({ m }: { m: ClipMoment }) {
  const cls = m.no_riskier
    ? "border-accent/40 text-accent"
    : "border-white/15 text-muted";
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] uppercase ${cls}`}>
      {m.no_riskier ? "no riskier" : m.difficulty}
    </span>
  );
}

/** Whose moment it is. A coach reads these two completely differently. */
function Side({ m }: { m: ClipMoment }) {
  const on = m.side === "defending";
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] uppercase ${
        on ? "bg-white/[0.09] text-chalk-3" : "bg-accent/15 text-accent"
      }`}
    >
      {on ? "you defended" : "you attacked"}
    </span>
  );
}

export function Walkthrough({ onDone }: { onDone?: (seen: number) => void }) {
  const moments = CLIP_MOMENTS;
  const video = useRef<HTMLVideoElement>(null);
  const raf = useRef<number>(0);
  const tail = useRef<HTMLDivElement>(null);

  const [index, setIndex] = useState(0);
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);

  const current = moments[index];
  const atEnd = index >= moments.length - 1;
  const seen = moments.slice(0, index + 1);

  // Play the run-in, then stop on the pass. The pause is the product.
  useEffect(() => {
    const v = video.current;
    if (!v || !current) return;
    setPaused(false);
    setT(0);
    const go = () => {
      v.currentTime = 0;
      v.play().catch(() => {});
    };
    if (v.readyState >= 1) go();
    else v.addEventListener("loadedmetadata", go, { once: true });
  }, [index, current]);

  useEffect(() => {
    const tick = () => {
      const v = video.current;
      if (v && current) {
        setT(v.currentTime);
        if (!v.paused && v.currentTime >= current.pass_at) {
          v.pause();
          setPaused(true);
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [current]);

  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [index, finished]);

  const replay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
    setPaused(false);
  }, []);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  }, []);

  if (!current) return null;

  const frame = frameAt(current, t);
  const prevFrame = frame
    ? current.frames[Math.max(0, current.frames.indexOf(frame) - 3)]
    : undefined;
  const dur = current.frames.length
    ? current.frames[current.frames.length - 1].t
    : current.pass_at + 4;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <ChalkFilters />
      {/* ── The footage, pinned ───────────────────────────────────────── */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] px-4 py-2.5">
            <span className="flex items-baseline gap-2.5">
              <span className="font-mono text-[12px] tabular-nums text-accent">
                {current.match_clock}
              </span>
              <span className="text-[14px] font-medium text-chalk">
                {current.surname}
              </span>
              <Side m={current} />
              <Tag m={current} />
            </span>
            <span className="font-mono text-[10px] tracking-[0.1em] text-muted-2 uppercase">
              {index + 1} of {moments.length}
            </span>
          </div>

          <div className="relative aspect-video w-full bg-black">
            <video
              key={current.key}
              ref={video}
              src={current.clip}
              className="absolute inset-0 h-full w-full object-cover"
              playsInline
              muted
              preload="auto"
              onClick={toggle}
            />

            <div className="pointer-events-none absolute inset-0">
              {frame?.players.map((p, i) => (
                <span
                  key={i}
                  className="absolute border"
                  style={{
                    left: `${p.box[0] * 100}%`,
                    top: `${p.box[1] * 100}%`,
                    width: `${(p.box[2] - p.box[0]) * 100}%`,
                    height: `${(p.box[3] - p.box[1]) * 100}%`,
                    borderColor: KIT[p.team] ?? "rgba(255,255,255,0.4)",
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
                  }}
                />
              ))}
            </div>

            {/* Chalk on the picture, computed from the boxes on the picture. */}
            {frame && (
              <ChalkOverlay
                players={frame.players}
                previous={prevFrame?.players}
                team={current.side === "defending" ? 0 : 1}
                seed={current.id * 17 + 3}
              />
            )}

            <span className="pointer-events-none absolute top-3 left-3 rounded bg-black/75 px-2 py-1 font-mono text-[10px] tabular-nums text-chalk backdrop-blur-sm">
              {clockAt(current, t)}
              {frame ? ` · ${frame.players.length} tracked` : ""}
            </span>

            <AnimatePresence>
              {paused && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="pointer-events-none absolute top-3 right-3 rounded bg-accent px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-canvas uppercase"
                >
                  the moment
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {/* ── Controls, always on screen ──────────────────────────── */}
          <div className="flex items-center gap-2.5 px-3.5 py-3">
            <button
              onClick={toggle}
              aria-label={paused ? "Play" : "Pause"}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-warm transition-colors hover:bg-white/[0.13] hover:text-chalk"
            >
              {paused ? (
                <svg width="11" height="12" viewBox="0 0 16 18" fill="currentColor">
                  <path d="M0 0l16 9-16 9z" />
                </svg>
              ) : (
                <svg width="11" height="12" viewBox="0 0 16 18" fill="currentColor">
                  <path d="M0 0h5v18H0zM11 0h5v18h-5z" />
                </svg>
              )}
            </button>

            <div
              className="relative h-5 flex-1 cursor-pointer"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const v = video.current;
                if (v) v.currentTime = ((e.clientX - r.left) / r.width) * dur;
              }}
            >
              <span className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 rounded-full bg-white/[0.09]" />
              <span
                className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-accent"
                style={{ width: `${Math.min(100, (t / dur) * 100)}%` }}
              />
              <span
                title="the pass"
                className="absolute top-1/2 h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-chalk"
                style={{ left: `${(current.pass_at / dur) * 100}%` }}
              />
            </div>

            <button
              onClick={replay}
              className="shrink-0 rounded-lg bg-white/[0.05] px-2.5 py-1.5 font-mono text-[10px] text-warm transition-colors hover:bg-white/[0.11] hover:text-chalk"
            >
              run it again
            </button>
          </div>

          {/* What was on, under the frozen picture. */}
          <div className="border-t border-white/[0.05] p-4">
            <span className="mb-2 block font-mono text-[10px] tracking-[0.12em] text-muted-2 uppercase">
              what was on
            </span>
            <MomentFrame moment={current} />
          </div>
        </div>

        <p className="mt-2 px-1 font-mono text-[10px] leading-relaxed text-muted-2">
          real seconds of the final &middot; {current.detections.toLocaleString()}{" "}
          detections in this clip &middot; cut on the broadcast clock
        </p>
      </div>

      {/* ── The coaching ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3.5">
        {seen.map((m, i) => (
          <Turn key={m.key} showWho={i === 0}>
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
                    {m.match_clock}
                  </span>
                  <span className="text-[13px] font-medium text-chalk">
                    {m.surname}
                  </span>
                  <Side m={m} />
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
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="text-[14px] leading-relaxed text-warm-2"
              >
                <StreamText
                  text={`That is the footage I have. ${moments.filter((m) => m.side === "attacking").length} you missed, ${moments.filter((m) => m.side === "defending").length} you survived. All of them a ball into the box that would have made a chance, not a tidier pass in midfield.`}
                  onDone={() => onDone?.(moments.length)}
                />
              </motion.p>
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
