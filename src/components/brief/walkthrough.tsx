"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Choice } from "@/components/brief/atoms/choice";
import { StreamText } from "@/components/brief/atoms/stream-text";
import { MomentFrame } from "@/components/report/moment-frame";
import { CLIP_MOMENTS, ClipMoment, matchClock } from "@/content/clip";
import { KIT, VIDEO, nearestFrame } from "@/lib/tape";

/**
 * Going through the moments on the actual footage.
 *
 * Two things had to be true before this could be honest, and both are now.
 *
 * **The moments are in the clip.** The eight headline moments come from the
 * whole match and none of them fall inside the ninety seconds we hold, so
 * playing them "on the tape" would have drawn one passage of play over a
 * different one. Reading the broadcast clock off the overlay fixed it: the
 * clip runs 20:24 to 21:54 of the final, continuous and in real time, and the
 * seven passes the engine flagged in that window each land on a known second.
 *
 * **The player names are real.** They come from the event stream, which
 * already records who played each pass, so nothing here needs an identity
 * model or a demo roster.
 *
 * The interaction is the one a coach actually does with a video: it plays, it
 * stops on the thing worth stopping on, someone talks over the frozen frame,
 * then it runs on. Pep pauses the video himself rather than asking the coach
 * to scrub.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

/** Start each moment a beat early so the coach sees the ball arrive. */
const RUN_IN_S = 2.2;

function DifficultyTag({ m }: { m: ClipMoment }) {
  if (m.no_riskier) {
    return (
      <span className="rounded border border-accent/40 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-accent uppercase">
        no riskier
      </span>
    );
  }
  return (
    <span className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-muted uppercase">
      {m.difficulty}
    </span>
  );
}

export function Walkthrough({ onDone }: { onDone?: (seen: number) => void }) {
  const moments = CLIP_MOMENTS;
  const video = useRef<HTMLVideoElement>(null);
  const raf = useRef<number>(0);

  const [index, setIndex] = useState(0);
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);

  const current = moments[index];
  const atEnd = index >= moments.length - 1;

  // Run from just before the moment up to it, then stop. The pause is the
  // product: it is where a coach would hit the spacebar anyway.
  useEffect(() => {
    const v = video.current;
    if (!v || !current) return;
    setPaused(false);
    const start = Math.max(0, current.video_t - RUN_IN_S);
    const go = () => {
      v.currentTime = start;
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
        if (!v.paused && v.currentTime >= current.video_t) {
          v.pause();
          setPaused(true);
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [current]);

  const replay = useCallback(() => {
    const v = video.current;
    if (!v || !current) return;
    v.currentTime = Math.max(0, current.video_t - RUN_IN_S);
    v.play().catch(() => {});
    setPaused(false);
  }, [current]);

  const frame = nearestFrame(t);

  if (!current) return null;

  return (
    <div className="flex flex-col gap-4">
      <motion.article
        key={current.id}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-white/[0.05] px-4 py-2.5">
          <span className="flex items-baseline gap-2.5">
            <span className="font-mono text-[11px] tabular-nums text-accent">
              {matchClock(current.video_t)}
            </span>
            <span className="text-[13px] font-medium text-chalk">
              {current.name}
            </span>
            <DifficultyTag m={current} />
          </span>
          <span className="font-mono text-[10px] tracking-[0.1em] text-muted-2 uppercase">
            {index + 1} of {moments.length}
          </span>
        </div>

        {/* ── The footage, stopped on the moment ────────────────────── */}
        <div className="relative aspect-video w-full bg-black">
          <video
            ref={video}
            src={VIDEO}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            muted
            preload="auto"
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

          <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/75 px-2 py-1 font-mono text-[10px] tabular-nums text-chalk backdrop-blur-sm">
            {matchClock(t)}
            {frame ? ` · ${frame.players.length} tracked` : ""}
          </span>

          <AnimatePresence>
            {paused && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute right-3 top-3 rounded bg-accent px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-canvas uppercase"
              >
                stopped here
              </motion.span>
            )}
          </AnimatePresence>

          <button
            onClick={replay}
            className="absolute bottom-3 right-3 rounded-lg bg-black/75 px-2.5 py-1.5 font-mono text-[10px] text-warm backdrop-blur-sm transition-colors hover:bg-black/90 hover:text-chalk"
          >
            run it again
          </button>
        </div>

        {/* ── What was on ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <span className="mb-2 block font-mono text-[10px] tracking-[0.12em] text-muted-2 uppercase">
              what was on
            </span>
            <MomentFrame moment={current} />
          </div>

          <div className="flex flex-col">
            <p className="text-[15px] leading-relaxed text-warm">
              <StreamText text={current.line} />
            </p>

            <div className="mt-auto pt-4">
              <p className="font-mono text-[10px] leading-relaxed text-muted">
                {current.numbers}
              </p>
              <p className="mt-1.5 font-mono text-[10px] text-muted-2">
                played {current.played_zone} &middot; available{" "}
                {current.best_zone}
              </p>
            </div>
          </div>
        </div>
      </motion.article>

      <AnimatePresence mode="wait">
        {!finished && !atEnd && (
          <Choice
            key={`more-${index}`}
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
        )}

        {!finished && atEnd && (
          <motion.p
            key="end"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="text-[15px] leading-relaxed text-warm-2"
          >
            <StreamText
              text={`That is all ${moments.length} from this passage. Ask me about any player or any clip and I will pull it up.`}
              onDone={() => onDone?.(moments.length)}
            />
          </motion.p>
        )}

        {finished && (
          <motion.p
            key="stopped"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[14px] leading-relaxed text-muted"
          >
            Stopped there. The rest are waiting whenever you want them.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
